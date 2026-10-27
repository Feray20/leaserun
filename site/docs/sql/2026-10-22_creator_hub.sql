-- LeaseRun Creator Hub – Phase 1: Onboarding, Zahlungsdaten-Tresor, Vereinbarung, Admin-Review, Rollen, Audit.
--
-- Grundsätze (wie im übrigen Projekt):
--   * Alle Schreibzugriffe laufen über die Server-Schnittstellen (Secret Key). Der Browser schreibt nie direkt.
--   * RLS ist überall aktiv. Creator dürfen über die Datenbank-API höchstens ihre EIGENEN, nicht sensiblen
--     Zeilen lesen (Defense in Depth, falls einmal direkt gelesen wird). Zahlungsdaten, Audit und Rollen
--     haben keinerlei Client-Zugriff.
--   * IBAN wird in der Anwendung mit AES-256-GCM verschlüsselt (Schlüssel CREATOR_PII_KEY, nur in Vercel).
--     In der Datenbank liegen nur Chiffrat, die letzten 4 Ziffern, das Land und ein HMAC-Fingerabdruck.
--   * Audit-Protokoll und Vereinbarungs-Zustimmungen sind unveränderbar (kein UPDATE/DELETE/TRUNCATE).
--   * Zahlungsdaten werden nie überschrieben: Eine Änderung legt einen neuen Datensatz an, der alte wird
--     als SUPERSEDED markiert (Nachvollziehbarkeit bevorstehender Auszahlungen).
--
-- Anwenden: Supabase → SQL Editor (oder Supabase-Branch zum Testen). Rückgängig: 2026-10-22_creator_hub_rollback.sql
-- Tests:    docs/sql/tests/creator_hub_rls_test.sql (läuft gegen eine Datenbank, auf der diese Migration angewendet ist)

begin;

-- ---------------------------------------------------------------------------
-- 1) Creator (ein Datensatz je Konto)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','SUBMITTED','UNDER_REVIEW','INFO_REQUESTED','ACTIVE','REJECTED','SUSPENDED')),
  -- Konto
  first_name text check (first_name is null or char_length(first_name) between 1 and 80),
  last_name text check (last_name is null or char_length(last_name) between 1 and 80),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  phone text check (phone is null or char_length(phone) <= 40),
  -- Profil
  display_name text check (display_name is null or char_length(display_name) between 2 and 80),
  company text check (company is null or char_length(company) <= 120),
  website text check (website is null or (char_length(website) <= 200 and website ~ '^https://')),
  bio text check (bio is null or char_length(bio) <= 600),
  categories text[] not null default '{}'
    check (categories <@ array['immobilien','finanzen','business','entrepreneurship','lifestyle','technology','education','other']::text[]),
  -- Attribution (wird bei Freigabe vergeben; enthält keine personenbezogenen Daten)
  ref_code text unique check (ref_code is null or ref_code ~ '^[a-z0-9]{10}$'),
  -- Offene Rückfrage des Admins (Klartext für den Creator; Historie in lr_creator_reviews)
  info_request text check (info_request is null or char_length(info_request) <= 2000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lr_creators_status_idx on public.lr_creators (status, submitted_at desc);

-- Öffentliche Social-Media-Profile (keine OAuth-Verbindung, keine Zugangsdaten).
create table if not exists public.lr_creator_socials (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  platform text not null check (platform in ('youtube','tiktok','instagram','x','linkedin','other')),
  platform_label text check (platform_label is null or char_length(platform_label) <= 40),
  channel_name text check (channel_name is null or char_length(channel_name) <= 100),
  handle text check (handle is null or char_length(handle) <= 100),
  url text not null check (char_length(url) <= 300 and url ~ '^https://'),
  follower_range text check (follower_range is null or follower_range in ('lt_1k','1k_10k','10k_50k','50k_100k','100k_500k','500k_1m','gt_1m')),
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_socials_creator_idx on public.lr_creator_socials (creator_id);

-- Business- und Rechnungsdaten (nur, was für Gutschrift/Rechnung tatsächlich nötig ist).
create table if not exists public.lr_creator_business (
  creator_id uuid primary key references public.lr_creators(id) on delete cascade,
  entity_type text not null check (entity_type in ('individual','company')),
  legal_name text not null check (char_length(legal_name) between 2 and 160),
  legal_form text check (legal_form is null or char_length(legal_form) <= 60),
  street text not null check (char_length(street) between 3 and 160),
  postal_code text not null check (char_length(postal_code) between 3 and 12),
  city text not null check (char_length(city) between 2 and 80),
  country text not null check (country ~ '^[A-Z]{2}$'),
  tax_number text check (tax_number is null or char_length(tax_number) <= 30),
  vat_id text check (vat_id is null or vat_id ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'),
  vat_status text not null check (vat_status in ('small_business','vat_registered','not_applicable')),
  billing_email text not null check (char_length(billing_email) <= 200 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Zahlungsdaten-Tresor (kein Client-Zugriff, Chiffrat statt Klartext, versioniert)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  holder_name text not null check (char_length(holder_name) between 2 and 140),
  iban_enc text not null check (iban_enc ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  iban_last4 text not null check (iban_last4 ~ '^[0-9A-Z]{4}$'),
  iban_country text not null check (iban_country ~ '^[A-Z]{2}$'),
  iban_fingerprint text not null check (iban_fingerprint ~ '^[0-9a-f]{64}$'),
  bic text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  status text not null check (status in ('PROVIDED','VERIFICATION_REQUIRED','VERIFIED','SUPERSEDED')),
  confirmed_at timestamptz not null,
  verified_at timestamptz,
  verified_by text,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
-- Höchstens ein aktuelles Auszahlungskonto je Creator.
create unique index if not exists lr_creator_payout_current_uq
  on public.lr_creator_payout_accounts (creator_id) where status <> 'SUPERSEDED';

-- Kontodaten selbst sind unveränderbar; nur Status, Prüfung und Ablösung dürfen sich ändern.
create or replace function public.lr_creator_payout_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.creator_id is distinct from old.creator_id or new.holder_name is distinct from old.holder_name
     or new.iban_enc is distinct from old.iban_enc or new.iban_last4 is distinct from old.iban_last4
     or new.iban_country is distinct from old.iban_country or new.iban_fingerprint is distinct from old.iban_fingerprint
     or new.bic is distinct from old.bic or new.confirmed_at is distinct from old.confirmed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Zahlungsdaten sind unveränderbar. Änderungen legen einen neuen Datensatz an.';
  end if;
  if old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED' then
    raise exception 'Abgelöste Zahlungsdaten können nicht reaktiviert werden.';
  end if;
  return new;
end $$;

-- Direktes Löschen ist gesperrt. Ausnahme: Kontolöschung (DSGVO Art. 17) über die Kaskade von lr_creators
-- (dann läuft dieser Trigger innerhalb des Fremdschlüssel-Triggers, pg_trigger_depth() > 1).
create or replace function public.lr_creator_payout_guard_delete() returns trigger
language plpgsql set search_path to '' as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Zahlungsdaten werden nicht gelöscht, sondern abgelöst (SUPERSEDED).';
end $$;
drop trigger if exists lr_creator_payout_guard_trg on public.lr_creator_payout_accounts;
create trigger lr_creator_payout_guard_trg before update on public.lr_creator_payout_accounts
  for each row execute function public.lr_creator_payout_guard();
drop trigger if exists lr_creator_payout_guard_del_trg on public.lr_creator_payout_accounts;
create trigger lr_creator_payout_guard_del_trg before delete on public.lr_creator_payout_accounts
  for each row execute function public.lr_creator_payout_guard_delete();

-- Kontowechsel in EINER Transaktion: bisheriges Konto ablösen, neues anlegen. Nur für den Server (service_role).
create or replace function public.lr_creator_payout_replace(
  p_creator uuid, p_holder text, p_enc text, p_last4 text, p_country text, p_fingerprint text, p_bic text, p_status text
) returns uuid language plpgsql set search_path to '' as $$
declare nid uuid;
begin
  if p_status not in ('PROVIDED','VERIFICATION_REQUIRED') then raise exception 'Ungültiger Ausgangsstatus.'; end if;
  perform 1 from public.lr_creators where id = p_creator for update;
  if not found then raise exception 'Creator nicht gefunden.'; end if;
  update public.lr_creator_payout_accounts set status = 'SUPERSEDED', superseded_at = now()
    where creator_id = p_creator and status <> 'SUPERSEDED';
  insert into public.lr_creator_payout_accounts (creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, bic, status, confirmed_at)
    values (p_creator, p_holder, p_enc, p_last4, p_country, p_fingerprint, p_bic, p_status, now())
    returning id into nid;
  return nid;
end $$;
revoke all on function public.lr_creator_payout_replace(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.lr_creator_payout_replace(uuid, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Vereinbarung (versioniert, veröffentlichte Fassung unveränderbar) und Zustimmungen (unveränderbar)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_agreements (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]+)?$'),
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 50 and 60000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  is_draft boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function public.lr_creator_agreement_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then raise exception 'Veröffentlichte Vereinbarungen werden nicht gelöscht.'; end if;
    return old;
  end if;
  if old.published_at is not null and (new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.version is distinct from old.version or new.title is distinct from old.title or new.published_at is distinct from old.published_at) then
    raise exception 'Veröffentlichte Vereinbarungen sind unveränderbar. Bitte neue Version anlegen.';
  end if;
  if new.body_sha256 is distinct from encode(sha256(convert_to(new.body, 'UTF8')), 'hex') then
    raise exception 'Prüfsumme passt nicht zum Text.';
  end if;
  return new;
end $$;
drop trigger if exists lr_creator_agreement_guard_trg on public.lr_creator_agreements;
create trigger lr_creator_agreement_guard_trg before update or delete on public.lr_creator_agreements
  for each row execute function public.lr_creator_agreement_guard();

create table if not exists public.lr_creator_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  agreement_id uuid not null references public.lr_creator_agreements(id) on delete restrict,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'),
  accepted_at timestamptz not null default now(),
  unique (creator_id, agreement_id)
);

-- ---------------------------------------------------------------------------
-- 4) Prüfverlauf (Admin-Entscheidungen; Rückfragen und Ablehnungsgründe sind für den Creator sichtbar)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_reviews (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  action text not null check (action in ('START_REVIEW','APPROVE','REQUEST_INFO','REJECT','SUSPEND','REACTIVATE','NOTE')),
  message text check (message is null or char_length(message) <= 2000),
  visible_to_creator boolean not null default false,
  actor_ref text not null,
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_reviews_creator_idx on public.lr_creator_reviews (creator_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Admin-Rollen für den Creator-Bereich. Rollen grenzen ein, sie erweitern nie:
--    Zugang zum Web-Admin setzt weiterhin ADMIN_EMAILS + zweiten Faktor voraus.
--    Admins ohne Eintrag gelten als SUPER_ADMIN (abwärtskompatibel zum bestehenden Web-Admin).
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_admin_roles (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('SUPER_ADMIN','FINANCE_ADMIN','CREATOR_MANAGER','SUPPORT','READ_ONLY')),
  granted_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6) Audit (unveränderbar). Akteure nur pseudonymisiert; keine IBAN, keine Inhalte.
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_audit (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'CREATOR_CREATED','APPLICATION_SUBMITTED','REVIEW_STARTED','CREATOR_APPROVED','CREATOR_INFO_REQUESTED','CREATOR_REJECTED',
    'CREATOR_SUSPENDED','CREATOR_REACTIVATED','AGREEMENT_ACCEPTED',
    'BANK_DATA_ADDED','BANK_DATA_CHANGED','BANK_DETAILS_VIEWED','BANK_DATA_VERIFIED',
    'ADMIN_ROLE_CHANGED','ACCESS_DENIED',
    -- Folgephasen (Provision, Rechnung, Auszahlung) – hier schon zugelassen, damit das Protokoll nicht umgebaut werden muss:
    'COMMISSION_CHANGED','INVOICE_CREATED','INVOICE_APPROVED','INVOICE_REJECTED','PAYOUT_CREATED','PAYOUT_APPROVED','PAYOUT_PAID'
  )),
  creator_id uuid,
  actor_kind text not null check (actor_kind in ('creator','admin','system')),
  actor_ref text not null check (char_length(actor_ref) <= 64),
  actor_role text check (actor_role is null or actor_role in ('CREATOR','SUPER_ADMIN','FINANCE_ADMIN','CREATOR_MANAGER','SUPPORT','READ_ONLY','SYSTEM')),
  result text not null check (result in ('SUCCESS','DENIED','FAILED')),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_audit_creator_idx on public.lr_creator_audit (creator_id, created_at desc);
create index if not exists lr_creator_audit_type_idx on public.lr_creator_audit (event_type, created_at desc);

create or replace function public.lr_creator_audit_immutable() returns trigger
language plpgsql set search_path to '' as $$
begin raise exception 'Das Creator-Audit-Protokoll ist unveränderbar.'; end $$;
drop trigger if exists lr_creator_audit_no_change on public.lr_creator_audit;
create trigger lr_creator_audit_no_change before update or delete on public.lr_creator_audit
  for each row execute function public.lr_creator_audit_immutable();
drop trigger if exists lr_creator_audit_no_truncate on public.lr_creator_audit;
create trigger lr_creator_audit_no_truncate before truncate on public.lr_creator_audit
  for each statement execute function public.lr_creator_audit_immutable();

create or replace function public.lr_creator_acceptance_immutable() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if; -- Kontolöschung (Kaskade)
  raise exception 'Zustimmungen zur Vereinbarung sind unveränderbar.';
end $$;
drop trigger if exists lr_creator_acceptance_no_change on public.lr_creator_agreement_acceptances;
create trigger lr_creator_acceptance_no_change before update or delete on public.lr_creator_agreement_acceptances
  for each row execute function public.lr_creator_acceptance_immutable();

create or replace function public.lr_creator_review_immutable() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Der Prüfverlauf ist unveränderbar.';
end $$;
drop trigger if exists lr_creator_review_no_change on public.lr_creator_reviews;
create trigger lr_creator_review_no_change before update or delete on public.lr_creator_reviews
  for each row execute function public.lr_creator_review_immutable();

-- updated_at pflegen (vorhandene Projektfunktion)
drop trigger if exists lr_creators_touch on public.lr_creators;
create trigger lr_creators_touch before update on public.lr_creators for each row execute function public.lr_touch_updated_at();
drop trigger if exists lr_creator_business_touch on public.lr_creator_business;
create trigger lr_creator_business_touch before update on public.lr_creator_business for each row execute function public.lr_touch_updated_at();
drop trigger if exists lr_creator_admin_roles_touch on public.lr_creator_admin_roles;
create trigger lr_creator_admin_roles_touch before update on public.lr_creator_admin_roles for each row execute function public.lr_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Zugriffsschutz (RLS). Standard: alles gesperrt.
-- ---------------------------------------------------------------------------
alter table public.lr_creators enable row level security;
alter table public.lr_creator_socials enable row level security;
alter table public.lr_creator_business enable row level security;
alter table public.lr_creator_payout_accounts enable row level security;
alter table public.lr_creator_agreements enable row level security;
alter table public.lr_creator_agreement_acceptances enable row level security;
alter table public.lr_creator_reviews enable row level security;
alter table public.lr_creator_admin_roles enable row level security;
alter table public.lr_creator_audit enable row level security;

revoke all on public.lr_creators, public.lr_creator_socials, public.lr_creator_business,
  public.lr_creator_payout_accounts, public.lr_creator_agreements, public.lr_creator_agreement_acceptances,
  public.lr_creator_reviews, public.lr_creator_admin_roles, public.lr_creator_audit
  from anon, authenticated;

-- Creator: nur eigene, nicht sensible Zeilen lesen (mit zweitem Faktor, falls eingerichtet).
grant select on public.lr_creators, public.lr_creator_socials, public.lr_creator_business,
  public.lr_creator_agreements, public.lr_creator_agreement_acceptances, public.lr_creator_reviews to authenticated;

drop policy if exists creators_select_own on public.lr_creators;
create policy creators_select_own on public.lr_creators for select to authenticated
  using (user_id = (select auth.uid()) and public.lr_mfa_ok());

drop policy if exists creator_socials_select_own on public.lr_creator_socials;
create policy creator_socials_select_own on public.lr_creator_socials for select to authenticated
  using (exists (select 1 from public.lr_creators c where c.id = creator_id and c.user_id = (select auth.uid())) and public.lr_mfa_ok());

drop policy if exists creator_business_select_own on public.lr_creator_business;
create policy creator_business_select_own on public.lr_creator_business for select to authenticated
  using (exists (select 1 from public.lr_creators c where c.id = creator_id and c.user_id = (select auth.uid())) and public.lr_mfa_ok());

drop policy if exists creator_acceptances_select_own on public.lr_creator_agreement_acceptances;
create policy creator_acceptances_select_own on public.lr_creator_agreement_acceptances for select to authenticated
  using (exists (select 1 from public.lr_creators c where c.id = creator_id and c.user_id = (select auth.uid())));

drop policy if exists creator_reviews_select_own_visible on public.lr_creator_reviews;
create policy creator_reviews_select_own_visible on public.lr_creator_reviews for select to authenticated
  using (visible_to_creator and exists (select 1 from public.lr_creators c where c.id = creator_id and c.user_id = (select auth.uid())));

drop policy if exists creator_agreements_select_published on public.lr_creator_agreements;
create policy creator_agreements_select_published on public.lr_creator_agreements for select to authenticated
  using (published_at is not null);

-- Bewusst KEINE Policies für: lr_creator_payout_accounts, lr_creator_admin_roles, lr_creator_audit.

-- ---------------------------------------------------------------------------
-- 8) Einstellungen und erste Vereinbarungsfassung (ENTWURF – vor Livegang ersetzen)
-- ---------------------------------------------------------------------------
insert into public.lr_settings (key, value, updated_by)
values ('creator_bank_change_requires_review', 'true'::jsonb, 'migration:creator_hub')
on conflict (key) do nothing;

insert into public.lr_creator_agreements (version, title, body, body_sha256, is_draft, published_at)
select v.version, v.title, v.body, encode(sha256(convert_to(v.body, 'UTF8')), 'hex'), true, now()
from (values (
  '2026-10',
  'LeaseRun Creator-Partnervereinbarung (Entwurf)',
  E'ENTWURF – Diese Fassung ist ein Platzhalter und muss vor dem Livegang durch eine rechtlich geprüfte Vereinbarung ersetzt werden.\n\n'
  || E'1. Gegenstand. Der Creator erstellt in eigener Verantwortung und in eigenem Stil Inhalte zu LeaseRun und verwendet dafür die freigegebenen Materialien.\n\n'
  || E'2. Kennzeichnung. Werbliche Inhalte werden nach den jeweils geltenden Vorgaben als Werbung gekennzeichnet.\n\n'
  || E'3. Vergütung. Die Vergütung richtet sich nach der im Creator-Portal hinterlegten, versionierten Provisionsregel. Grundlage sind ausschließlich die serverseitig ermittelten Ergebnisse.\n\n'
  || E'4. Abrechnung und Auszahlung. Abgerechnet wird monatlich. Auszahlungen erfolgen auf das hinterlegte und bestätigte Konto.\n\n'
  || E'5. Datenschutz. LeaseRun verarbeitet die Angaben des Creators nur zur Durchführung dieser Vereinbarung. Social-Media-Konten werden nicht verbunden.\n\n'
  || E'6. Laufzeit. Die Vereinbarung kann von beiden Seiten mit einer Frist von 14 Tagen in Textform beendet werden.'
)) as v(version, title, body)
on conflict (version) do nothing;

commit;
