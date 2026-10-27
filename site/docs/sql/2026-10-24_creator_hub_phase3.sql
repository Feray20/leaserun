-- LeaseRun Creator Hub – Phase 3: Provisionsregeln, Anpassungen (Bonus/Korrektur/Rückforderung), Monatsabschluss,
-- Abrechnungen, Provisionszeilen, Dokumente (Abrechnung, Rechnung, Gutschrift), Auszahlungen.
-- Voraussetzung: Phase 1 und 2. Idempotent. Rückbau: 2026-10-24_creator_hub_phase3_rollback.sql
--
-- Grundsätze:
--   * Provisionen berechnet ausschließlich der Server (lib/creator/billing.ts); Beträge kommen nie aus dem Browser.
--   * Regeln sind versioniert: Eine Änderung beendet die alte Regel (valid_to) und legt eine neue Version an.
--   * Abgeschlossene Monate, ausgestellte Dokumente und bezahlte Auszahlungen sind unveränderbar.
--   * Spätere Erstattungen werden im nächsten Monat als Rückforderung verrechnet, nie rückwirkend geändert.

begin;

-- Abrechnungsverfahren je Creator: Rechnung des Creators (Standard) oder Gutschrift durch LeaseRun.
alter table public.lr_creators add column if not exists billing_mode text not null default 'INVOICE';
do $$ begin
  alter table public.lr_creators add constraint lr_creators_billing_mode_check check (billing_mode in ('INVOICE','CREDIT_NOTE'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Provisionsregeln (versioniert)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_commission_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  creator_id uuid references public.lr_creators(id) on delete cascade,
  campaign_slug text check (campaign_slug is null or campaign_slug ~ '^[a-z0-9-]{3,40}$'),
  kind text not null check (kind in ('PERCENT','FIXED','HYBRID','TIERED')),
  percent_bps integer not null default 0 check (percent_bps between 0 and 10000),
  fixed_cents integer not null default 0 check (fixed_cents between 0 and 1000000),
  tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) <= 10),
  valid_from timestamptz not null default now(),
  valid_to timestamptz check (valid_to is null or valid_to > valid_from),
  note text check (note is null or char_length(note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_rules_scope_idx on public.lr_creator_commission_rules (creator_id, campaign_slug, valid_from);

-- Regeln werden nie überschrieben: erlaubt ist nur das Beenden (valid_to setzen, einmalig).
create or replace function public.lr_creator_rule_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Provisionsregeln werden nicht gelöscht, sondern beendet.';
  end if;
  if (to_jsonb(new) - 'valid_to') is distinct from (to_jsonb(old) - 'valid_to') then raise exception 'Provisionsregeln sind versioniert und unveränderbar.'; end if;
  if old.valid_to is not null and new.valid_to is distinct from old.valid_to then raise exception 'Regel ist bereits beendet.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_rule_guard_trg on public.lr_creator_commission_rules;
create trigger lr_creator_rule_guard_trg before update or delete on public.lr_creator_commission_rules for each row execute function public.lr_creator_rule_guard();

-- ---------------------------------------------------------------------------
-- Abrechnungen je Creator und Monat
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_statements (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  period text not null check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('READY','INVOICED','APPROVED','PAID','ZERO')),
  billing_mode text not null check (billing_mode in ('INVOICE','CREDIT_NOTE')),
  conversions integer not null default 0,
  revenue_net_cents bigint not null default 0,
  commission_cents bigint not null default 0,
  adjustments_cents bigint not null default 0,
  net_cents bigint not null,
  vat_rate_bps integer not null default 0,
  vat_cents bigint not null default 0,
  gross_cents bigint not null,
  payout_cents bigint not null check (payout_cents >= 0),
  tax_mode text not null check (tax_mode in ('SMALL_BUSINESS','VAT_19','REVERSE_CHARGE','NOT_TAXABLE_DE','REVIEW_REQUIRED')),
  tax_note text not null,
  -- Momentaufnahme der Rechnungsdaten zum Abschluss (spätere Profiländerungen verändern abgeschlossene Monate nicht)
  billing_snapshot jsonb not null,
  carried_over boolean not null default false,
  closed_at timestamptz not null default now(),
  closed_by text not null,
  approved_at timestamptz, approved_by text,
  paid_at timestamptz,
  unique (creator_id, period)
);
create index if not exists lr_creator_statements_period_idx on public.lr_creator_statements (period, status);

-- Summen und Momentaufnahme sind nach dem Abschluss fest; nur der Status läuft vorwärts.
create or replace function public.lr_creator_statement_guard() returns trigger language plpgsql set search_path to '' as $$
declare ord text[] := array['READY','INVOICED','APPROVED','PAID'];
begin
  if tg_op = 'DELETE' then raise exception 'Abrechnungen werden nicht gelöscht.'; end if;
  if (to_jsonb(new) - array['status','approved_at','approved_by','paid_at','carried_over']) is distinct from
     (to_jsonb(old) - array['status','approved_at','approved_by','paid_at','carried_over']) then
    raise exception 'Abgeschlossene Abrechnungen sind unveränderbar.';
  end if;
  if old.status = 'ZERO' and new.status <> 'ZERO' then raise exception 'Abrechnung ohne Betrag bleibt abgeschlossen.'; end if;
  if old.status <> 'ZERO' and array_position(ord, new.status) < array_position(ord, old.status) then raise exception 'Status kann nicht zurückgesetzt werden.'; end if;
  if old.carried_over and not new.carried_over then raise exception 'Übertrag ist endgültig.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_statement_guard_trg on public.lr_creator_statements;
create trigger lr_creator_statement_guard_trg before update or delete on public.lr_creator_statements for each row execute function public.lr_creator_statement_guard();

-- Provision je Conversion (eine Zeile je Conversion; Grundlage der Abrechnung)
create table if not exists public.lr_creator_commissions (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null unique references public.lr_creator_conversions(id) on delete restrict,
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  statement_id uuid not null references public.lr_creator_statements(id) on delete restrict,
  period text not null,
  rule_id uuid references public.lr_creator_commission_rules(id) on delete restrict,
  rule_version integer,
  base_cents bigint not null check (base_cents >= 0),
  commission_cents bigint not null check (commission_cents >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PAID','CLAWED_BACK')),
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_commissions_creator_idx on public.lr_creator_commissions (creator_id, period);

create or replace function public.lr_creator_commission_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Provisionen werden nicht gelöscht.'; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then raise exception 'Provisionsbeträge sind unveränderbar.'; end if;
  if old.status = 'CLAWED_BACK' then raise exception 'Rückforderung ist endgültig.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_commission_guard_trg on public.lr_creator_commissions;
create trigger lr_creator_commission_guard_trg before update or delete on public.lr_creator_commissions for each row execute function public.lr_creator_commission_guard();

-- Anpassungen: Bonus, Korrektur, Rückforderung (Erstattung nach Abschluss), Übertrag eines negativen Saldos
create table if not exists public.lr_creator_adjustments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  period text not null check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  kind text not null check (kind in ('BONUS','CORRECTION','CLAWBACK','CARRY_OVER')),
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000),
  reason text not null check (char_length(reason) between 3 and 300),
  source_id uuid,
  statement_id uuid references public.lr_creator_statements(id) on delete restrict,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (kind, source_id)
);
create index if not exists lr_creator_adjustments_open_idx on public.lr_creator_adjustments (creator_id, period) where statement_id is null;

create or replace function public.lr_creator_adjustment_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if old.statement_id is null then return old; end if;
    raise exception 'Verrechnete Anpassungen werden nicht gelöscht.';
  end if;
  if old.statement_id is not null then raise exception 'Verrechnete Anpassungen sind unveränderbar.'; end if;
  if (to_jsonb(new) - 'statement_id') is distinct from (to_jsonb(old) - 'statement_id') then raise exception 'Anpassungen sind unveränderbar; bitte löschen und neu anlegen.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_adjustment_guard_trg on public.lr_creator_adjustments;
create trigger lr_creator_adjustment_guard_trg before update or delete on public.lr_creator_adjustments for each row execute function public.lr_creator_adjustment_guard();

-- ---------------------------------------------------------------------------
-- Dokumente (Abrechnung, Rechnung des Creators, Gutschrift, Storno) – privat, versioniert, unveränderbar
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_documents (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  statement_id uuid not null references public.lr_creator_statements(id) on delete restrict,
  doc_type text not null check (doc_type in ('STATEMENT','INVOICE','CREDIT_NOTE','CANCELLATION')),
  number text not null check (number ~ '^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,39}$'),
  version integer not null default 1,
  refers_to uuid references public.lr_creator_documents(id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^docs/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  totals jsonb not null,
  issued_at timestamptz not null default now(),
  created_by text not null,
  unique (creator_id, doc_type, number, version)
);
create index if not exists lr_creator_documents_statement_idx on public.lr_creator_documents (statement_id);
-- Je Abrechnung höchstens eine gültige Rechnung bzw. Gutschrift (Korrektur nur über Storno + neue Version).
create unique index if not exists lr_creator_documents_one_valid on public.lr_creator_documents (statement_id, doc_type) where doc_type in ('INVOICE','CREDIT_NOTE') and refers_to is null and version = 1;

create or replace function public.lr_creator_document_immutable() returns trigger language plpgsql set search_path to '' as $$
begin raise exception 'Ausgestellte Dokumente sind unveränderbar (§ 147 AO). Korrektur nur über Storno und neue Version.'; end $$;
drop trigger if exists lr_creator_document_immutable_trg on public.lr_creator_documents;
create trigger lr_creator_document_immutable_trg before update or delete on public.lr_creator_documents for each row execute function public.lr_creator_document_immutable();

-- ---------------------------------------------------------------------------
-- Auszahlungen
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_payouts (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null unique references public.lr_creator_statements(id) on delete restrict,
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  payout_account_id uuid not null references public.lr_creator_payout_accounts(id) on delete restrict,
  iban_country text not null, iban_last4 text not null,
  reference text not null check (char_length(reference) between 3 and 140),
  status text not null default 'READY' check (status in ('READY','APPROVED','EXPORTED','PAID','FAILED')),
  created_by text not null, created_at timestamptz not null default now(),
  approved_by text, approved_at timestamptz,
  exported_at timestamptz, export_id text,
  paid_by text, paid_at timestamptz,
  failed_reason text check (failed_reason is null or char_length(failed_reason) <= 300)
);
create index if not exists lr_creator_payouts_status_idx on public.lr_creator_payouts (status, created_at);

create or replace function public.lr_creator_payout_status_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Auszahlungen werden nicht gelöscht.'; end if;
  if new.amount_cents is distinct from old.amount_cents or new.payout_account_id is distinct from old.payout_account_id
     or new.statement_id is distinct from old.statement_id or new.creator_id is distinct from old.creator_id or new.reference is distinct from old.reference then
    raise exception 'Betrag, Konto und Verwendungszweck einer Auszahlung sind unveränderbar.';
  end if;
  if old.status = 'PAID' then raise exception 'Bezahlte Auszahlungen sind abgeschlossen.'; end if;
  if new.status = 'PAID' and old.status not in ('APPROVED','EXPORTED') then raise exception 'Nur freigegebene Auszahlungen können als bezahlt markiert werden.'; end if;
  if new.status = 'EXPORTED' and old.status <> 'APPROVED' and old.status <> 'EXPORTED' then raise exception 'Nur freigegebene Auszahlungen können exportiert werden.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_payout_status_guard_trg on public.lr_creator_payouts;
create trigger lr_creator_payout_status_guard_trg before update or delete on public.lr_creator_payouts for each row execute function public.lr_creator_payout_status_guard();

-- ---------------------------------------------------------------------------
-- Monatsabschluss in EINER Transaktion: Abrechnungen + Provisionszeilen anlegen, offene Anpassungen zuordnen,
-- negative Salden des Vormonats übertragen. Die Beträge berechnet der Server; die Funktion prüft Konsistenz.
--   p_statements: [{ creator_id, status, billing_mode, conversions, revenue_net_cents, commission_cents, adjustments_cents,
--                    net_cents, vat_rate_bps, vat_cents, gross_cents, payout_cents, tax_mode, tax_note, billing_snapshot,
--                    adjustment_ids: [uuid], lines: [{ conversion_id, rule_id, rule_version, base_cents, commission_cents }] }]
-- ---------------------------------------------------------------------------
create or replace function public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb)
returns integer language plpgsql set search_path to '' as $$
declare s jsonb; l jsonb; sid uuid; n integer := 0; sumc bigint;
begin
  if p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Ungültiger Zeitraum.'; end if;
  perform pg_advisory_xact_lock(hashtext('lr_creator_close:' || p_period));
  for s in select * from jsonb_array_elements(coalesce(p_statements, '[]'::jsonb)) loop
    select coalesce(sum((x->>'commission_cents')::bigint), 0) into sumc from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) x;
    if sumc <> (s->>'commission_cents')::bigint then raise exception 'Summe der Provisionszeilen passt nicht.'; end if;
    if (s->>'net_cents')::bigint <> (s->>'commission_cents')::bigint + (s->>'adjustments_cents')::bigint then raise exception 'Nettobetrag passt nicht.'; end if;
    insert into public.lr_creator_statements (creator_id, period, status, billing_mode, conversions, revenue_net_cents, commission_cents, adjustments_cents,
      net_cents, vat_rate_bps, vat_cents, gross_cents, payout_cents, tax_mode, tax_note, billing_snapshot, closed_by)
    values ((s->>'creator_id')::uuid, p_period, s->>'status', s->>'billing_mode', (s->>'conversions')::int, (s->>'revenue_net_cents')::bigint,
      (s->>'commission_cents')::bigint, (s->>'adjustments_cents')::bigint, (s->>'net_cents')::bigint, (s->>'vat_rate_bps')::int, (s->>'vat_cents')::bigint,
      (s->>'gross_cents')::bigint, (s->>'payout_cents')::bigint, s->>'tax_mode', s->>'tax_note', s->'billing_snapshot', p_actor)
    returning id into sid;
    for l in select * from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) loop
      insert into public.lr_creator_commissions (conversion_id, creator_id, statement_id, period, rule_id, rule_version, base_cents, commission_cents)
      values ((l->>'conversion_id')::uuid, (s->>'creator_id')::uuid, sid, p_period, nullif(l->>'rule_id', '')::uuid, nullif(l->>'rule_version', '')::int,
        (l->>'base_cents')::bigint, (l->>'commission_cents')::bigint);
    end loop;
    update public.lr_creator_adjustments set statement_id = sid
      where id in (select (x#>>'{}')::uuid from jsonb_array_elements(coalesce(s->'adjustment_ids', '[]'::jsonb)) x)
        and creator_id = (s->>'creator_id')::uuid and statement_id is null;
    if (select count(*) from public.lr_creator_adjustments where statement_id = sid) <> jsonb_array_length(coalesce(s->'adjustment_ids', '[]'::jsonb)) then
      raise exception 'Anpassungen wurden inzwischen geändert. Bitte erneut abschließen.';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Kennzahlen für Creator Billing (Admin) und Monatsabschluss-Kachel
create or replace function public.lr_creator_billing_overview(p_period text) returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'period', p_period,
    'closed', exists (select 1 from public.lr_creator_statements where period = p_period),
    'creators', (select count(*) from public.lr_creator_statements where period = p_period),
    'commission_cents', coalesce((select sum(commission_cents) from public.lr_creator_statements where period = p_period), 0),
    'invoices_open', (select count(*) from public.lr_creator_statements where period = p_period and status = 'READY' and billing_mode = 'INVOICE'),
    'payout_ready_cents', coalesce((select sum(p.amount_cents) from public.lr_creator_payouts p join public.lr_creator_statements s on s.id = p.statement_id where s.period = p_period and p.status in ('READY','APPROVED','EXPORTED')), 0),
    'paid_cents', coalesce((select sum(p.amount_cents) from public.lr_creator_payouts p join public.lr_creator_statements s on s.id = p.statement_id where s.period = p_period and p.status = 'PAID'), 0),
    'pending_total_cents', coalesce((select sum(commission_cents) from public.lr_creator_commissions where status = 'PENDING'), 0),
    'approved_total_cents', coalesce((select sum(commission_cents) from public.lr_creator_commissions where status = 'APPROVED'), 0),
    'paid_total_cents', coalesce((select sum(commission_cents) from public.lr_creator_commissions where status = 'PAID'), 0)
  );
$$;

-- Fortlaufende, lückenlose Nummern (z. B. Gutschriften je Jahr) über die bestehende Zählertabelle.
create or replace function public.lr_creator_next_number(p_name text) returns bigint language sql set search_path to '' as $$
  insert into public.lr_counters (name, value) values (p_name, 1)
  on conflict (name) do update set value = public.lr_counters.value + 1
  returning value;
$$;
revoke all on function public.lr_creator_next_number(text) from public, anon, authenticated;
grant execute on function public.lr_creator_next_number(text) to service_role;

revoke all on function public.lr_creator_close_period(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lr_creator_billing_overview(text) from public, anon, authenticated;
grant execute on function public.lr_creator_close_period(text, text, jsonb) to service_role;
grant execute on function public.lr_creator_billing_overview(text) to service_role;

-- ---------------------------------------------------------------------------
-- Audit-Ereignisse Phase 3
-- ---------------------------------------------------------------------------
alter table public.lr_creator_audit drop constraint if exists lr_creator_audit_event_type_check;
alter table public.lr_creator_audit add constraint lr_creator_audit_event_type_check check (event_type in (
  'CREATOR_CREATED','APPLICATION_SUBMITTED','REVIEW_STARTED','CREATOR_APPROVED','CREATOR_INFO_REQUESTED','CREATOR_REJECTED',
  'CREATOR_SUSPENDED','CREATOR_REACTIVATED','AGREEMENT_ACCEPTED',
  'BANK_DATA_ADDED','BANK_DATA_CHANGED','BANK_DETAILS_VIEWED','BANK_DATA_VERIFIED',
  'ADMIN_ROLE_CHANGED','ACCESS_DENIED',
  'CAMPAIGN_CHANGED','CAMPAIGN_MEMBERS_CHANGED','ASSET_CHANGED','ASSET_DOWNLOADED','BENEFIT_CHANGED',
  'CONTENT_SUBMITTED','CONTENT_REVIEWED','CONVERSION_RECORDED','CONVERSION_REVERSED',
  'COMMISSION_CHANGED','ADJUSTMENT_CREATED','PERIOD_CLOSED','BILLING_MODE_CHANGED','STATEMENT_APPROVED','DOCUMENT_DOWNLOADED',
  'INVOICE_CREATED','INVOICE_APPROVED','INVOICE_REJECTED','PAYOUT_CREATED','PAYOUT_APPROVED','PAYOUT_EXPORTED','PAYOUT_PAID','PAYOUT_FAILED',
  'CREATOR_ACCOUNT_DELETED'
));

-- ---------------------------------------------------------------------------
-- RLS: Creator lesen eigene Abrechnungen, Dokument-Metadaten und Auszahlungen. Regeln, Provisionszeilen und
-- Anpassungen nur über den Server (die API zeigt dem Creator die für ihn relevanten Summen).
-- ---------------------------------------------------------------------------
alter table public.lr_creator_commission_rules enable row level security;
alter table public.lr_creator_statements enable row level security;
alter table public.lr_creator_commissions enable row level security;
alter table public.lr_creator_adjustments enable row level security;
alter table public.lr_creator_documents enable row level security;
alter table public.lr_creator_payouts enable row level security;
revoke all on public.lr_creator_commission_rules, public.lr_creator_statements, public.lr_creator_commissions, public.lr_creator_adjustments,
  public.lr_creator_documents, public.lr_creator_payouts from anon, authenticated;
grant select on public.lr_creator_statements, public.lr_creator_documents, public.lr_creator_payouts to authenticated;

drop policy if exists creator_statements_select_own on public.lr_creator_statements;
create policy creator_statements_select_own on public.lr_creator_statements for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.id = lr_creator_statements.creator_id and c.user_id = (select auth.uid())));
drop policy if exists creator_documents_select_own on public.lr_creator_documents;
create policy creator_documents_select_own on public.lr_creator_documents for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.id = lr_creator_documents.creator_id and c.user_id = (select auth.uid())));
drop policy if exists creator_payouts_select_own on public.lr_creator_payouts;
create policy creator_payouts_select_own on public.lr_creator_payouts for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.id = lr_creator_payouts.creator_id and c.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Kontolöschung (Art. 17 DSGVO) bei bestehenden Abrechnungsdaten
-- Ohne Conversions/Abrechnungen/Auszahlungen wird der Creator vollständig gelöscht (Kaskade).
-- Mit solchen Daten (Aufbewahrung nach § 147 AO / § 257 HGB) wird der Creator vom Login gelöst,
-- gesperrt und von nicht abrechnungsrelevanten Angaben bereinigt; Abrechnungen, Belege,
-- Rechnungsanschrift und Zahlungsdaten der Auszahlungen bleiben erhalten.
-- ---------------------------------------------------------------------------
alter table public.lr_creators alter column user_id drop not null;

create or replace function public.lr_creator_account_deleted(p_user uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select id, status into c from public.lr_creators where user_id = p_user for update;
  if not found then return 'none'; end if;
  if not exists (select 1 from public.lr_creator_conversions where creator_id = c.id)
     and not exists (select 1 from public.lr_creator_statements where creator_id = c.id)
     and not exists (select 1 from public.lr_creator_payouts where creator_id = c.id) then
    delete from public.lr_creators where id = c.id;
    return 'deleted';
  end if;
  delete from public.lr_creator_socials where creator_id = c.id;
  delete from public.lr_creator_campaign_members where creator_id = c.id;
  update public.lr_creators set user_id = null, status = 'SUSPENDED', phone = null, bio = null, website = null,
    categories = '{}', info_request = null where id = c.id;
  insert into public.lr_creator_audit (creator_id, event_type, actor_kind, actor_ref, actor_role, result, meta)
  values (c.id, 'CREATOR_ACCOUNT_DELETED', 'system', 'account-deletion', 'SYSTEM', 'SUCCESS', jsonb_build_object('previous_status', c.status));
  return 'archived';
end $$;
revoke all on function public.lr_creator_account_deleted(uuid) from public, anon, authenticated;
grant execute on function public.lr_creator_account_deleted(uuid) to service_role;

-- Privater Speicher für Abrechnungsdokumente
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-documents', 'creator-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false;

-- Einstellungen
insert into public.lr_settings (key, value, updated_by) values
  ('creator_close_delay_days', '15'::jsonb, 'migration:creator_hub_phase3'),
  ('creator_payout_four_eyes', 'false'::jsonb, 'migration:creator_hub_phase3')
on conflict (key) do nothing;

-- Standard-Provisionsregel (Platzhalter, bitte im Admin anpassen): 20 % vom Netto-Umsatz.
insert into public.lr_creator_commission_rules (kind, percent_bps, note, created_by)
select 'PERCENT', 2000, 'Standardregel (Platzhalter) – im Admin anpassen', 'migration:creator_hub_phase3'
where not exists (select 1 from public.lr_creator_commission_rules);

commit;
