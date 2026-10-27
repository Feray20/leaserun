-- LeaseRun Creator Hub – Phase 4: Teilerstattungen, Kontoauszug-Abgleich (camt.053), automatischer Monatsabschluss
-- Voraussetzung: Phase 1–3. Idempotent. Nur Migrationsdatei – vor dem Livegang im Supabase SQL Editor ausführen.
begin;

-- ---------------------------------------------------------------------------
-- 1) Erstattungen je Conversion (auch Teilerstattungen). Eine Zeile je neuem Erstattungsstand von Stripe;
--    refunded_net_cents ist der Zuwachs (netto, anteilig zum Kaufbetrag). Unveränderbar bis auf die Verrechnung.
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_refunds (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null references public.lr_creator_conversions(id) on delete restrict,
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  stripe_charge_id text check (stripe_charge_id is null or stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9_]+$'),
  refunded_total_cents bigint not null check (refunded_total_cents > 0),  -- kumulierter Erstattungsbetrag laut Stripe (brutto)
  refunded_net_cents bigint not null check (refunded_net_cents > 0),      -- Zuwachs netto (Grundlage der Verrechnung)
  full_refund boolean not null default false,
  processed_at timestamptz,
  processed_as text check (processed_as is null or processed_as in ('BASE','CLAWBACK','REVERSED','IGNORED')),
  created_at timestamptz not null default now(),
  unique (conversion_id, refunded_total_cents)
);
create index if not exists lr_creator_refunds_open_idx on public.lr_creator_refunds (conversion_id) where processed_at is null;

create or replace function public.lr_creator_refund_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Erstattungen werden nicht gelöscht.'; end if;
  if (to_jsonb(new) - array['processed_at','processed_as']) is distinct from (to_jsonb(old) - array['processed_at','processed_as']) then
    raise exception 'Erstattungen sind unveränderbar.';
  end if;
  if old.processed_at is not null then raise exception 'Erstattung ist bereits verrechnet.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_refund_guard_trg on public.lr_creator_refunds;
create trigger lr_creator_refund_guard_trg before update or delete on public.lr_creator_refunds
  for each row execute function public.lr_creator_refund_guard();

-- Erstattungsstand aus Stripe übernehmen (Webhook charge.refunded – kommt auch bei Teilerstattungen).
-- Sperrt die Conversion, berechnet den netto-Zuwachs anteilig und nimmt die Conversion bei vollständiger Erstattung zurück.
create or replace function public.lr_creator_record_refund(p_payment_intent text, p_charge text, p_amount bigint, p_refunded bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare c record; total_net bigint; prev bigint; delta bigint; full_r boolean; out jsonb := '[]'::jsonb;
begin
  if p_payment_intent is null or p_payment_intent !~ '^pi_[A-Za-z0-9_]+$' then return out; end if;
  if p_amount is null or p_amount <= 0 or p_refunded is null or p_refunded <= 0 then return out; end if;
  full_r := p_refunded >= p_amount;
  for c in select id, creator_id, amount_net_cents, status from public.lr_creator_conversions
           where stripe_payment_intent = p_payment_intent for update loop
    if c.status = 'REVERSED' then continue; end if;
    total_net := case when full_r then c.amount_net_cents else round(c.amount_net_cents::numeric * p_refunded / p_amount)::bigint end;
    select coalesce(sum(refunded_net_cents), 0) into prev from public.lr_creator_refunds where conversion_id = c.id;
    delta := total_net - prev;
    if delta > 0 then
      insert into public.lr_creator_refunds (conversion_id, creator_id, stripe_charge_id, refunded_total_cents, refunded_net_cents, full_refund)
      values (c.id, c.creator_id, p_charge, p_refunded, delta, full_r)
      on conflict (conversion_id, refunded_total_cents) do nothing;
    end if;
    if full_r then
      update public.lr_creator_conversions set status = 'REVERSED', reversed_at = now() where id = c.id;
    end if;
    out := out || jsonb_build_object('conversion_id', c.id, 'creator_id', c.creator_id, 'refunded_net_cents', greatest(delta, 0), 'full', full_r);
  end loop;
  return out;
end $$;
revoke all on function public.lr_creator_record_refund(text, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.lr_creator_record_refund(text, text, bigint, bigint) to service_role;

-- Monatsabschluss: zusätzlich die beim Abschluss berücksichtigten Erstattungen (geringere Grundlage) in derselben
-- Transaktion als verrechnet markieren. Signatur unverändert; neu ist das optionale Feld refund_ids je Abrechnung.
create or replace function public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb)
returns integer language plpgsql set search_path to '' as $$
declare s jsonb; l jsonb; sid uuid; n integer := 0; sumc bigint; nref integer;
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
    update public.lr_creator_refunds set processed_at = now(), processed_as = 'BASE'
      where id in (select (x#>>'{}')::uuid from jsonb_array_elements(coalesce(s->'refund_ids', '[]'::jsonb)) x)
        and creator_id = (s->>'creator_id')::uuid and processed_at is null;
    get diagnostics nref = row_count;
    if nref <> jsonb_array_length(coalesce(s->'refund_ids', '[]'::jsonb)) then
      raise exception 'Erstattungen wurden inzwischen geändert. Bitte erneut abschließen.';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lr_creator_close_period(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.lr_creator_close_period(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Benachrichtigungen zur Abrechnung (Hinweis „bereit“ und eine Erinnerung bei fehlender Rechnung)
-- ---------------------------------------------------------------------------
alter table public.lr_creator_statements add column if not exists notified_at timestamptz;
alter table public.lr_creator_statements add column if not exists reminded_at timestamptz;

-- Abrechnungs-Schutz mit den neuen Feldern: siehe Abschnitt 3b (eine Fassung für beide Erweiterungen).

-- ---------------------------------------------------------------------------
-- 3) Kontoauszug-Abgleich: Herkunft der Zahlungsbestätigung und importierte Auszüge
-- ---------------------------------------------------------------------------
alter table public.lr_creator_payouts add column if not exists paid_via text;
alter table public.lr_creator_payouts add column if not exists bank_ref text;
do $$ begin
  alter table public.lr_creator_payouts add constraint lr_creator_payouts_paid_via_check check (paid_via is null or paid_via in ('MANUAL','BANK_STATEMENT'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lr_creator_payouts add constraint lr_creator_payouts_bank_ref_check check (bank_ref is null or char_length(bank_ref) <= 120);
exception when duplicate_object then null; end $$;

create table if not exists public.lr_creator_bank_imports (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  statement_id text check (statement_id is null or char_length(statement_id) <= 80),
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9A-Z]{4}$'),
  entries integer not null check (entries >= 0),
  matched integer not null check (matched >= 0),
  imported_by text not null,
  created_at timestamptz not null default now()
);
create or replace function public.lr_creator_bank_import_immutable() returns trigger language plpgsql set search_path to '' as $$
begin raise exception 'Importierte Kontoauszüge sind unveränderbar.'; end $$;
drop trigger if exists lr_creator_bank_import_no_change on public.lr_creator_bank_imports;
create trigger lr_creator_bank_import_no_change before update or delete on public.lr_creator_bank_imports
  for each row execute function public.lr_creator_bank_import_immutable();

-- ---------------------------------------------------------------------------
-- 3b) Rückläufer nach „bezahlt“: Auszahlung → RETURNED, Abrechnung wieder offen (APPROVED), Konto zur Prüfung.
--     Danach erneute Auszahlung derselben Abrechnung (gleicher Betrag, gleicher Beleg) auf das aktuelle, geprüfte Konto.
-- ---------------------------------------------------------------------------
alter table public.lr_creator_payouts add column if not exists returned_at timestamptz;
alter table public.lr_creator_payouts add column if not exists reissue_count integer not null default 0;
alter table public.lr_creator_payouts drop constraint if exists lr_creator_payouts_status_check;
alter table public.lr_creator_payouts add constraint lr_creator_payouts_status_check check (status in ('READY','APPROVED','EXPORTED','PAID','FAILED','RETURNED'));

create or replace function public.lr_creator_payout_status_guard() returns trigger language plpgsql set search_path to '' as $$
declare reissue boolean := old.status = 'RETURNED' and new.status = 'READY';
begin
  if tg_op = 'DELETE' then raise exception 'Auszahlungen werden nicht gelöscht.'; end if;
  if new.amount_cents is distinct from old.amount_cents or new.statement_id is distinct from old.statement_id
     or new.creator_id is distinct from old.creator_id or new.reference is distinct from old.reference then
    raise exception 'Betrag, Konto und Verwendungszweck einer Auszahlung sind unveränderbar.';
  end if;
  if (new.payout_account_id is distinct from old.payout_account_id or new.iban_last4 is distinct from old.iban_last4
      or new.iban_country is distinct from old.iban_country) and not reissue then
    raise exception 'Betrag, Konto und Verwendungszweck einer Auszahlung sind unveränderbar.';
  end if;
  if new.reissue_count < old.reissue_count then raise exception 'Zähler kann nicht zurückgesetzt werden.'; end if;
  if old.status = 'PAID' then
    if new.status <> 'RETURNED' then raise exception 'Bezahlte Auszahlungen sind abgeschlossen.'; end if;
    if (to_jsonb(new) - array['status','returned_at','failed_reason']) is distinct from (to_jsonb(old) - array['status','returned_at','failed_reason']) then
      raise exception 'Bezahlte Auszahlungen sind abgeschlossen.';
    end if;
  end if;
  if new.status = 'RETURNED' and old.status not in ('PAID','RETURNED') then raise exception 'Nur bezahlte Auszahlungen können zurückkommen.'; end if;
  if old.status = 'RETURNED' and new.status not in ('RETURNED','READY') then raise exception 'Zurückgekommene Auszahlungen werden nur neu angestoßen.'; end if;
  if new.status = 'PAID' and old.status not in ('APPROVED','EXPORTED') then raise exception 'Nur freigegebene Auszahlungen können als bezahlt markiert werden.'; end if;
  if new.status = 'EXPORTED' and old.status <> 'APPROVED' and old.status <> 'EXPORTED' then raise exception 'Nur freigegebene Auszahlungen können exportiert werden.'; end if;
  return new;
end $$;

-- Abrechnungs-Schutz: PAID → APPROVED nur innerhalb von lr_creator_payout_returned (Sitzungsmerker).
create or replace function public.lr_creator_statement_guard() returns trigger language plpgsql set search_path to '' as $$
declare ord text[] := array['READY','INVOICED','APPROVED','PAID'];
        free text[] := array['status','approved_at','approved_by','paid_at','carried_over','notified_at','reminded_at'];
        back boolean := old.status = 'PAID' and new.status = 'APPROVED' and coalesce(current_setting('immo.creator_payout_return', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'Abrechnungen werden nicht gelöscht.'; end if;
  if (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'Abgeschlossene Abrechnungen sind unveränderbar.';
  end if;
  if old.status = 'ZERO' and new.status <> 'ZERO' then raise exception 'Abrechnung ohne Betrag bleibt abgeschlossen.'; end if;
  if old.status <> 'ZERO' and array_position(ord, new.status) < array_position(ord, old.status) and not back then raise exception 'Status kann nicht zurückgesetzt werden.'; end if;
  if old.carried_over and not new.carried_over then raise exception 'Übertrag ist endgültig.'; end if;
  if old.notified_at is not null and new.notified_at is distinct from old.notified_at then raise exception 'Benachrichtigung ist bereits vermerkt.'; end if;
  if old.reminded_at is not null and new.reminded_at is distinct from old.reminded_at then raise exception 'Erinnerung ist bereits vermerkt.'; end if;
  return new;
end $$;

create or replace function public.lr_creator_payout_returned(p_payout uuid, p_reason text) returns jsonb
language plpgsql set search_path to '' as $$
declare p record;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into p from public.lr_creator_payouts where id = p_payout for update;
  if not found then raise exception 'Auszahlung nicht gefunden.'; end if;
  if p.status = 'RETURNED' then return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'changed', false); end if;
  if p.status <> 'PAID' then raise exception 'Nur bezahlte Auszahlungen können zurückkommen.'; end if;
  perform set_config('immo.creator_payout_return', 'on', true);
  update public.lr_creator_payouts set status = 'RETURNED', returned_at = now(), failed_reason = left(trim(p_reason), 300) where id = p.id;
  update public.lr_creator_statements set status = 'APPROVED', paid_at = null where id = p.statement_id and status = 'PAID';
  update public.lr_creator_commissions set status = 'APPROVED' where statement_id = p.statement_id and status = 'PAID';
  update public.lr_creator_payout_accounts set status = 'VERIFICATION_REQUIRED' where id = p.payout_account_id and status in ('PROVIDED','VERIFIED');
  perform set_config('immo.creator_payout_return', 'off', true);
  return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'changed', true);
end $$;

-- Erneut anstoßen: auf das aktuelle Konto des Creators (nicht abgelöst, nicht in Prüfung); Freigabe erfolgt wie üblich.
create or replace function public.lr_creator_payout_reissue(p_payout uuid, p_actor text) returns jsonb
language plpgsql set search_path to '' as $$
declare p record; a record;
begin
  select * into p from public.lr_creator_payouts where id = p_payout for update;
  if not found then raise exception 'Auszahlung nicht gefunden.'; end if;
  if p.status <> 'RETURNED' then raise exception 'Nur zurückgekommene Auszahlungen können neu angestoßen werden.'; end if;
  select id, status, iban_country, iban_last4 into a from public.lr_creator_payout_accounts
    where creator_id = p.creator_id and status <> 'SUPERSEDED' for update;
  if not found then raise exception 'Der Creator hat keine Zahlungsdaten hinterlegt.'; end if;
  if a.status = 'VERIFICATION_REQUIRED' then raise exception 'Die Zahlungsdaten müssen zuerst geprüft werden.'; end if;
  update public.lr_creator_payouts set status = 'READY', payout_account_id = a.id, iban_country = a.iban_country, iban_last4 = a.iban_last4,
    approved_by = null, approved_at = null, exported_at = null, export_id = null, paid_by = null, paid_at = null, paid_via = null, bank_ref = null,
    created_by = p_actor, reissue_count = p.reissue_count + 1
  where id = p.id;
  return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'iban_last4', a.iban_last4);
end $$;
revoke all on function public.lr_creator_payout_returned(uuid, text) from public, anon, authenticated;
revoke all on function public.lr_creator_payout_reissue(uuid, text) from public, anon, authenticated;
grant execute on function public.lr_creator_payout_returned(uuid, text) to service_role;
grant execute on function public.lr_creator_payout_reissue(uuid, text) to service_role;

-- Zugriff: nur Server (Service-Rolle); Creator sehen Erstattungen und Importe nicht.
alter table public.lr_creator_refunds enable row level security;
alter table public.lr_creator_bank_imports enable row level security;
revoke all on public.lr_creator_refunds, public.lr_creator_bank_imports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Audit-Ereignisse Phase 4
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
  'CREATOR_ACCOUNT_DELETED',
  'REFUND_RECORDED','BANK_STATEMENT_IMPORTED','CREATOR_NOTIFIED','SETTINGS_CHANGED','PAYOUT_RETURNED','PAYOUT_REISSUED'
));

-- ---------------------------------------------------------------------------
-- 5) Einstellungen
-- ---------------------------------------------------------------------------
insert into public.lr_settings (key, value, updated_by) values
  ('creator_auto_close', 'false'::jsonb, 'migration:creator_hub_phase4'),
  ('creator_invoice_reminder_days', '7'::jsonb, 'migration:creator_hub_phase4')
on conflict (key) do nothing;

commit;
