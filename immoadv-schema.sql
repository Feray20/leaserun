-- Full schema backup of the ImmoAdv Supabase project (mieoylqhtvghcnvaxutg), exported 2026-10-17.
-- Reference for the LeaseRun US port. Contains structure only, no customer data.


-- ===================== Extensions =====================
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ===================== Sequences =====================
create sequence if not exists public.immo_b2b_customer_seq start 1 increment 1;
create sequence if not exists public.immo_verify_views_id_seq start 1 increment 1;
create sequence if not exists public.immo_admin_audit_id_seq start 1 increment 1;
create sequence if not exists public.immo_webhook_log_id_seq start 1 increment 1;
create sequence if not exists public.immo_security_log_id_seq start 1 increment 1;

-- ===================== Tables =====================
create table public.evidence_refs (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  page integer,
  field text not null,
  confidence numeric not null,
  extraction_method text not null,
  excerpt_hash text,
  status text default 'REVIEW_REQUIRED'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_access_audit (
  id bigint generated always as identity not null,
  owner_id uuid,
  deal_id uuid,
  document_id uuid,
  share_id uuid,
  action text not null,
  actor text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_admin_audit (
  id bigint default nextval('immo_admin_audit_id_seq'::regclass) not null,
  actor_email text not null,
  action text not null,
  target text,
  meta jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_analytics (
  id bigint generated always as identity not null,
  ts timestamp with time zone default now() not null,
  seg text not null,
  ev text not null,
  visitor text,
  path text,
  ref text,
  src text,
  med text,
  camp text,
  device text,
  browser text,
  os text,
  country text,
  plan text,
  region text,
  city text
);

create table public.immo_audit_log (
  id uuid default gen_random_uuid() not null,
  actor_user_id uuid,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_b2b_accounts (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  customer_number text default ((('KD-'::text || to_char((now() AT TIME ZONE 'Europe/Berlin'::text), 'YYYY'::text)) || '-'::text) || lpad((nextval('immo_b2b_customer_seq'::regclass))::text, 5, '0'::text)) not null,
  company_name text not null,
  legal_form text not null,
  institution_type text not null,
  register_number text,
  tax_id text,
  advisor_name text not null,
  email text not null,
  phone text,
  street text,
  postal_code text not null,
  city text not null,
  plan_tier text,
  plan_source text,
  plan_until timestamp with time zone,
  status text default 'pending'::text not null,
  lock_reason text,
  dossier_bonus integer default 0 not null,
  has_whitelabel boolean default false not null,
  allow_invoice_payment boolean default false not null,
  invoice_limit_cents integer,
  payment_terms_days integer default 14 not null,
  unternehmer_confirmed_at timestamp with time zone,
  avv_accepted_at timestamp with time zone,
  avv_version text,
  referral text,
  logo_path text,
  brand_color text,
  booking_url text,
  slug text,
  widget_key text,
  widget_active boolean default true not null,
  allowed_domains text[] default '{}'::text[] not null,
  lead_gate boolean default true not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  verified_at timestamp with time zone,
  billing_interval text,
  support_access_until timestamp with time zone,
  accept_submissions boolean default false not null,
  custom_disclaimer text,
  lead_retention_months integer default 24 not null,
  webhook_url text,
  webhook_secret text,
  verification_status text default 'offen'::text not null,
  verification_note text,
  verification_submitted_at timestamp with time zone,
  verification_decided_at timestamp with time zone,
  brand_color2 text,
  brand_font text,
  doc_title text,
  doc_sender text,
  doc_footer text,
  avv_evidence jsonb
);

create table public.immo_b2b_clients (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  invited_by uuid,
  client_name text,
  client_email text,
  token_hash text,
  expires_at timestamp with time zone,
  client_user_id uuid,
  status text default 'eingeladen'::text not null,
  consent_at timestamp with time zone,
  consent_text text,
  ended_at timestamp with time zone,
  ended_by text,
  created_at timestamp with time zone default now() not null,
  last_request_at timestamp with time zone,
  request_note text,
  request_seen_at timestamp with time zone,
  ready_notified_at timestamp with time zone,
  radar_consent_at timestamp with time zone,
  radar_consent_text text,
  inviter_consent_at timestamp with time zone
);

create table public.immo_b2b_contact (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  name text not null,
  company text not null,
  email text not null,
  phone text,
  message text,
  status text default 'offen'::text not null,
  ip_hash text,
  created_at timestamp with time zone default now() not null,
  institution_type text,
  city text,
  account_id uuid,
  legal_form text,
  register_number text,
  tax_id text,
  proof_kind text,
  proof_path text,
  proof_name text,
  proof_size integer,
  proof_sha256 text
);

create table public.immo_b2b_invites (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  email text not null,
  token_hash text not null,
  expires_at timestamp with time zone not null,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.immo_b2b_leads (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  source text not null,
  client_name text not null,
  client_email text not null,
  client_phone text,
  message text,
  property_data jsonb default '{}'::jsonb not null,
  metrics jsonb,
  consent_at timestamp with time zone not null,
  consent_text text not null,
  status text default 'neu'::text not null,
  ip_hash text,
  created_at timestamp with time zone default now() not null,
  assigned_to uuid,
  notes text
);

create table public.immo_b2b_members (
  account_id uuid not null,
  user_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_b2b_partner_codes (
  code text not null,
  description text,
  active boolean default true not null,
  max_redemptions integer,
  redeemed integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_b2b_submissions (
  id uuid default gen_random_uuid() not null,
  from_account_id uuid not null,
  from_user_id uuid,
  to_account_id uuid not null,
  version_id uuid,
  object_label text,
  note text,
  consent_confirmed_at timestamp with time zone not null,
  status text default 'eingegangen'::text not null,
  reply text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_b2b_usage (
  account_id uuid not null,
  month text not null,
  kind text not null,
  n integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_b2b_verification_docs (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  kind text not null,
  file_name text not null,
  storage_path text not null,
  byte_size integer not null,
  sha256 text not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_package_sections (
  id uuid default gen_random_uuid() not null,
  package_id uuid not null,
  section_key text not null,
  page_order integer not null,
  title text not null,
  payload jsonb default '{}'::jsonb not null,
  evidence_ids uuid[] default '{}'::uuid[] not null,
  status text default 'draft'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_bank_packages (
  id uuid default gen_random_uuid() not null,
  deal_id uuid not null,
  owner_id uuid not null,
  version integer default 1 not null,
  package jsonb default '{}'::jsonb not null,
  qr_share_id uuid,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_pdf_audit (
  id uuid default gen_random_uuid() not null,
  pdf_version_id uuid not null,
  package_id uuid not null,
  event_type text not null,
  actor_id uuid,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_pdf_versions (
  id uuid default gen_random_uuid() not null,
  package_id uuid not null,
  version_no integer not null,
  sha256_hex text not null,
  storage_bucket text default 'bank-ready-pdf'::text not null,
  storage_path text not null,
  mime_type text default 'application/pdf'::text not null,
  byte_size bigint not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_ready_scores (
  id uuid default gen_random_uuid() not null,
  property_id uuid,
  underwriting_case_id uuid,
  score numeric not null,
  dscr_component numeric default 0 not null,
  icr_component numeric default 0 not null,
  ltv_component numeric default 0 not null,
  documentation_component numeric default 0 not null,
  legal_component numeric default 0 not null,
  technical_component numeric default 0 not null,
  liquidity_component numeric default 0 not null,
  drivers jsonb default '[]'::jsonb not null,
  policy_label text default 'ImmoAdv interne Risikoklassifizierung'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_share_events (
  id uuid default gen_random_uuid() not null,
  share_link_id uuid not null,
  package_id uuid not null,
  pdf_version_id uuid,
  event_type text not null,
  actor_id uuid,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_bank_share_links (
  id uuid default gen_random_uuid() not null,
  package_id uuid not null,
  pdf_version_id uuid,
  token_hash text not null,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  max_uses integer,
  use_count integer default 0 not null,
  last_failed_at timestamp with time zone,
  failed_attempts integer default 0 not null
);

create table public.immo_campaigns (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  name text not null,
  slug text not null,
  channel text not null,
  segment text default 'b2b'::text not null,
  target_path text default '/b2b'::text not null,
  notes text,
  active boolean default true not null
);

create table public.immo_client_errors (
  id uuid default gen_random_uuid() not null,
  fingerprint text not null,
  message text not null,
  source text,
  page text,
  area text,
  browser text,
  count integer default 1 not null,
  first_seen timestamp with time zone default now() not null,
  last_seen timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table public.immo_counters (
  name text not null,
  value bigint default 0 not null
);

create table public.immo_crm_activities (
  id bigint generated always as identity not null,
  contact_id uuid not null,
  at timestamp with time zone default now() not null,
  type text not null,
  campaign text,
  note text,
  actor text
);

create table public.immo_crm_contacts (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  kind text default 'bank'::text not null,
  company text not null,
  branch text,
  contact_name text,
  salutation text,
  role text,
  street text,
  postal_code text,
  city text,
  phone text,
  email text,
  website text,
  source text not null,
  status text default 'neu'::text not null,
  next_at date,
  notes text,
  objection_at timestamp with time zone,
  account_id uuid
);

create table public.immo_data_room_access_log (
  id uuid default gen_random_uuid() not null,
  share_id uuid,
  deal_id uuid,
  owner_id uuid,
  actor_type text default 'banker'::text not null,
  action text not null,
  document_id uuid,
  ip_hash text,
  user_agent text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_data_room_shares (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  deal_id uuid,
  token_hash text not null,
  permissions jsonb default '{}'::jsonb not null,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  max_views integer,
  view_count integer default 0 not null,
  max_downloads integer,
  download_count integer default 0 not null,
  object_ref text
);

create table public.immo_deals (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  name text not null,
  status text default 'draft'::text not null,
  inputs jsonb default '{}'::jsonb not null,
  metrics jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_decision_scenarios (
  id uuid default gen_random_uuid() not null,
  property_id uuid,
  name text not null,
  interest_delta numeric default 0 not null,
  vacancy_delta numeric default 0 not null,
  maintenance_delta numeric default 0 not null,
  rent_delta numeric default 0 not null,
  dscr numeric,
  icr numeric,
  cashflow numeric,
  liquidity_reserve numeric,
  bank_ready_score numeric,
  created_at timestamp with time zone default now() not null
);

create table public.immo_document_events (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  owner_id uuid not null,
  event_type text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_document_ingestion_jobs (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  owner_id uuid not null,
  status text default 'queued'::text not null,
  sha256 text,
  mime_type text,
  storage_bucket text default 'immo-private'::text not null,
  storage_path text,
  document_class text,
  extracted_entities jsonb default '{}'::jsonb not null,
  validation_result jsonb default '{}'::jsonb not null,
  error_message text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_document_requests (
  id uuid default gen_random_uuid() not null,
  share_id uuid not null,
  owner_id uuid not null,
  object_ref text not null,
  category text not null,
  note text default ''::text not null,
  status text default 'offen'::text not null,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table public.immo_documents (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  deal_id uuid,
  filename text not null,
  mime_type text,
  storage_key text,
  sha256 text,
  classification text,
  extraction jsonb default '{}'::jsonb not null,
  status text default 'uploaded'::text not null,
  created_at timestamp with time zone default now() not null,
  object_ref text,
  category text,
  size_bytes bigint
);

create table public.immo_entitlements (
  user_id uuid not null,
  plan text default 'analysis'::text not null,
  status text default 'active'::text not null,
  trial_ends_at timestamp with time zone,
  valid_until timestamp with time zone,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_evidence (
  id uuid default gen_random_uuid() not null,
  deal_id uuid not null,
  source_type text not null,
  source_ref text,
  claim text not null,
  value jsonb,
  confidence numeric(5,4),
  created_at timestamp with time zone default now() not null
);

create table public.immo_freischaltungen (
  email text not null,
  record_id uuid not null,
  created_at timestamp with time zone default now() not null,
  aufgehoben_at timestamp with time zone
);

create table public.immo_invites (
  id uuid default gen_random_uuid() not null,
  code_hash text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  used_by text,
  used_at timestamp with time zone
);

create table public.immo_invoices (
  id uuid default gen_random_uuid() not null,
  invoice_number text not null,
  kind text not null,
  refers_to uuid,
  source text not null,
  account_id uuid,
  buyer jsonb not null,
  items jsonb not null,
  net_cents bigint not null,
  vat_rate numeric(5,2) default 19 not null,
  vat_cents bigint not null,
  gross_cents bigint not null,
  payment_method text not null,
  payment_status text default 'PENDING'::text not null,
  issue_date date default ((now() AT TIME ZONE 'Europe/Berlin'::text))::date not null,
  service_period text,
  due_date date,
  paid_at timestamp with time zone,
  pdf_path text,
  pdf_sha256 text,
  stripe_invoice_id text,
  stripe_pdf_url text,
  created_by text,
  created_at timestamp with time zone default now() not null
);

create table public.immo_kaeufe (
  checkout_session_id text not null,
  email text not null,
  plan text,
  betrag integer,
  waehrung text,
  guthaben integer default 0 not null,
  payment_intent text,
  erstattet_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.immo_kreditmappe_credits (
  owner_id uuid not null,
  object_ref text not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_kreditmappe_versions (
  id uuid not null,
  owner_id uuid not null,
  object_ref text not null,
  version_no integer not null,
  sha256 text not null,
  byte_size bigint not null,
  storage_path text not null,
  created_at timestamp with time zone default now() not null,
  b2b_account_id uuid
);

create table public.immo_newsletter (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  email text not null,
  name text,
  company text,
  segment text default 'b2b'::text not null,
  source text,
  token_hash text not null,
  confirmed_at timestamp with time zone,
  unsubscribed_at timestamp with time zone,
  consent_text text not null,
  ip_hash text
);

create table public.immo_newsletter_deliveries (
  id bigint generated always as identity not null,
  send_id uuid not null,
  subscriber_id uuid,
  email text not null,
  ok boolean not null,
  at timestamp with time zone default now() not null
);

create table public.immo_newsletter_sends (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  campaign_slug text,
  subject text not null,
  body text not null,
  segment text default 'b2b'::text not null,
  recipients integer default 0 not null,
  failed integer default 0 not null,
  actor text
);

create table public.immo_partners (
  slug text not null,
  name text not null,
  kind text default 'bank'::text not null,
  active boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_records (
  id uuid default gen_random_uuid() not null,
  owner_email text not null,
  kind text not null,
  data jsonb default '{}'::jsonb not null,
  deleted boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_reminder_log (
  owner_id uuid not null,
  object_ref text not null,
  kind text not null,
  due date not null,
  threshold_days integer not null,
  sent_at timestamp with time zone default now() not null
);

create table public.immo_security_blocks (
  ip_hash text not null,
  created_at timestamp with time zone default now() not null,
  until timestamp with time zone,
  reason text,
  created_by text
);

create table public.immo_security_log (
  id bigint default nextval('immo_security_log_id_seq'::regclass) not null,
  kind text not null,
  bucket text,
  subject text,
  created_at timestamp with time zone default now() not null,
  ip_hash text,
  detail text,
  acknowledged_at timestamp with time zone
);

create table public.immo_sessions (
  token_hash text not null,
  email text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null
);

create table public.immo_settings (
  key text not null,
  value jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text
);

create table public.immo_stress_scenarios (
  id uuid default gen_random_uuid() not null,
  underwriting_case_id uuid not null,
  scenario text not null,
  interest_rate numeric not null,
  vacancy_rate numeric not null,
  maintenance_costs numeric not null,
  noi numeric not null,
  cfads numeric not null,
  debt_service numeric not null,
  dscr numeric,
  icr numeric,
  annual_cashflow numeric not null,
  liquidity_reserve numeric default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_suppression (
  key_hash text not null,
  kind text not null,
  reason text default 'werbewiderspruch'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.immo_underwriting_cases (
  id uuid default gen_random_uuid() not null,
  deal_id uuid,
  property_id uuid,
  net_operating_income numeric default 0 not null,
  cfads numeric default 0 not null,
  debt_service numeric default 0 not null,
  interest_expense numeric default 0 not null,
  debt_amount numeric default 0 not null,
  purchase_price numeric default 0 not null,
  lending_value numeric default 0 not null,
  dscr numeric,
  icr numeric,
  ltv_purchase numeric,
  ltv_lending_value numeric,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.immo_user_data (
  user_id uuid not null,
  email text not null,
  profile jsonb default '{}'::jsonb not null,
  objects jsonb default '[]'::jsonb not null,
  progress jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  version integer default 1 not null,
  last_saved_at timestamp with time zone
);

create table public.immo_users (
  email text not null,
  pw_hash text not null,
  pw_salt text not null,
  pw_iter integer default 210000 not null,
  tarif text default 'frei'::text not null,
  gesperrt boolean default false not null,
  created_at timestamp with time zone default now() not null,
  last_login_at timestamp with time zone
);

create table public.immo_verify_views (
  id bigint default nextval('immo_verify_views_id_seq'::regclass) not null,
  version_id uuid not null,
  b2b_account_id uuid,
  ip_hash text,
  created_at timestamp with time zone default now() not null
);

create table public.immo_veto_events (
  id uuid default gen_random_uuid() not null,
  deal_id uuid not null,
  rule_code text not null,
  severity text not null,
  status text default 'open'::text not null,
  evidence jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table public.immo_veto_findings (
  id uuid default gen_random_uuid() not null,
  deal_id uuid,
  property_id uuid,
  veto_level text not null,
  category text not null,
  title text not null,
  explanation text not null,
  financial_impact numeric,
  recommendation text,
  evidence_ids uuid[] default '{}'::uuid[] not null,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.immo_webhook_log (
  id bigint default nextval('immo_webhook_log_id_seq'::regclass) not null,
  account_id uuid not null,
  event text not null,
  status integer,
  error text,
  created_at timestamp with time zone default now() not null
);

create table public.immo_zugang (
  email text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  pro_status text,
  pro_plan text,
  pro_geprueft_at timestamp with time zone,
  objekt_guthaben integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table public.properties (
  id uuid default gen_random_uuid() not null,
  street text,
  house_number text,
  postal_code text,
  city text,
  country text default 'DE'::text,
  parcel_flur text,
  parcel_flurstueck text,
  land_area_m2 numeric,
  living_area_m2 numeric,
  usable_area_m2 numeric,
  year_built integer,
  renovation_year integer,
  heating_type text,
  heating_generator_year integer,
  energy_consumption numeric,
  primary_energy_demand numeric,
  energy_efficiency_class text,
  purchase_price numeric,
  ancillary_costs numeric,
  property_transfer_tax numeric,
  broker_cost numeric,
  notary_cost numeric,
  land_register_cost numeric,
  market_value numeric,
  lending_value numeric,
  building_share numeric,
  land_share numeric,
  mea numeric,
  ownership_structure jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.property_documents (
  id uuid default gen_random_uuid() not null,
  property_id uuid,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  document_kind text default 'OTHER'::text not null,
  status text default 'UPLOADED'::text not null,
  storage_path text not null,
  immutable_original boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table public.rt_admin_sessions (
  token_hash text not null,
  email text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null
);

create table public.rt_admins (
  email text not null,
  pw_hash text,
  pw_salt text,
  created_at timestamp with time zone default now() not null
);

create table public.rt_config (
  key text not null,
  value text not null
);

create table public.rt_login_attempts (
  id bigint generated always as identity not null,
  who text not null,
  ok boolean not null,
  created_at timestamp with time zone default now() not null
);

-- ===================== Constraints =====================
alter table public.evidence_refs add constraint evidence_refs_pkey PRIMARY KEY (id);
alter table public.immo_access_audit add constraint immo_access_audit_pkey PRIMARY KEY (id);
alter table public.immo_admin_audit add constraint immo_admin_audit_pkey PRIMARY KEY (id);
alter table public.immo_analytics add constraint immo_analytics_pkey PRIMARY KEY (id);
alter table public.immo_audit_log add constraint immo_audit_log_pkey PRIMARY KEY (id);
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_pkey PRIMARY KEY (id);
alter table public.immo_b2b_clients add constraint immo_b2b_clients_pkey PRIMARY KEY (id);
alter table public.immo_b2b_contact add constraint immo_b2b_contact_pkey PRIMARY KEY (id);
alter table public.immo_b2b_invites add constraint immo_b2b_invites_pkey PRIMARY KEY (id);
alter table public.immo_b2b_leads add constraint immo_b2b_leads_pkey PRIMARY KEY (id);
alter table public.immo_b2b_members add constraint immo_b2b_members_pkey PRIMARY KEY (account_id, user_id);
alter table public.immo_b2b_partner_codes add constraint immo_b2b_partner_codes_pkey PRIMARY KEY (code);
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_pkey PRIMARY KEY (id);
alter table public.immo_b2b_usage add constraint immo_b2b_usage_pkey PRIMARY KEY (account_id, month, kind);
alter table public.immo_b2b_verification_docs add constraint immo_b2b_verification_docs_pkey PRIMARY KEY (id);
alter table public.immo_bank_package_sections add constraint immo_bank_package_sections_pkey PRIMARY KEY (id);
alter table public.immo_bank_packages add constraint immo_bank_packages_pkey PRIMARY KEY (id);
alter table public.immo_bank_pdf_audit add constraint immo_bank_pdf_audit_pkey PRIMARY KEY (id);
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_pkey PRIMARY KEY (id);
alter table public.immo_bank_ready_scores add constraint immo_bank_ready_scores_pkey PRIMARY KEY (id);
alter table public.immo_bank_share_events add constraint immo_bank_share_events_pkey PRIMARY KEY (id);
alter table public.immo_bank_share_links add constraint immo_bank_share_links_pkey PRIMARY KEY (id);
alter table public.immo_campaigns add constraint immo_campaigns_pkey PRIMARY KEY (id);
alter table public.immo_client_errors add constraint immo_client_errors_pkey PRIMARY KEY (id);
alter table public.immo_counters add constraint immo_counters_pkey PRIMARY KEY (name);
alter table public.immo_crm_activities add constraint immo_crm_activities_pkey PRIMARY KEY (id);
alter table public.immo_crm_contacts add constraint immo_crm_contacts_pkey PRIMARY KEY (id);
alter table public.immo_data_room_access_log add constraint immo_data_room_access_log_pkey PRIMARY KEY (id);
alter table public.immo_data_room_shares add constraint immo_data_room_shares_pkey PRIMARY KEY (id);
alter table public.immo_deals add constraint immo_deals_pkey PRIMARY KEY (id);
alter table public.immo_decision_scenarios add constraint immo_decision_scenarios_pkey PRIMARY KEY (id);
alter table public.immo_document_events add constraint immo_document_events_pkey PRIMARY KEY (id);
alter table public.immo_document_ingestion_jobs add constraint immo_document_ingestion_jobs_pkey PRIMARY KEY (id);
alter table public.immo_document_requests add constraint immo_document_requests_pkey PRIMARY KEY (id);
alter table public.immo_documents add constraint immo_documents_pkey PRIMARY KEY (id);
alter table public.immo_entitlements add constraint immo_entitlements_pkey PRIMARY KEY (user_id);
alter table public.immo_evidence add constraint immo_evidence_pkey PRIMARY KEY (id);
alter table public.immo_freischaltungen add constraint immo_freischaltungen_pkey PRIMARY KEY (email, record_id);
alter table public.immo_invites add constraint immo_invites_pkey PRIMARY KEY (id);
alter table public.immo_invoices add constraint immo_invoices_pkey PRIMARY KEY (id);
alter table public.immo_kaeufe add constraint immo_kaeufe_pkey PRIMARY KEY (checkout_session_id);
alter table public.immo_kreditmappe_credits add constraint immo_kreditmappe_credits_pkey PRIMARY KEY (owner_id, object_ref);
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_pkey PRIMARY KEY (id);
alter table public.immo_newsletter add constraint immo_newsletter_pkey PRIMARY KEY (id);
alter table public.immo_newsletter_deliveries add constraint immo_newsletter_deliveries_pkey PRIMARY KEY (id);
alter table public.immo_newsletter_sends add constraint immo_newsletter_sends_pkey PRIMARY KEY (id);
alter table public.immo_partners add constraint immo_partners_pkey PRIMARY KEY (slug);
alter table public.immo_records add constraint immo_records_pkey PRIMARY KEY (id);
alter table public.immo_reminder_log add constraint immo_reminder_log_pkey PRIMARY KEY (owner_id, object_ref, kind, due, threshold_days);
alter table public.immo_security_blocks add constraint immo_security_blocks_pkey PRIMARY KEY (ip_hash);
alter table public.immo_security_log add constraint immo_security_log_pkey PRIMARY KEY (id);
alter table public.immo_sessions add constraint immo_sessions_pkey PRIMARY KEY (token_hash);
alter table public.immo_settings add constraint immo_settings_pkey PRIMARY KEY (key);
alter table public.immo_stress_scenarios add constraint immo_stress_scenarios_pkey PRIMARY KEY (id);
alter table public.immo_suppression add constraint immo_suppression_pkey PRIMARY KEY (key_hash);
alter table public.immo_underwriting_cases add constraint immo_underwriting_cases_pkey PRIMARY KEY (id);
alter table public.immo_user_data add constraint immo_user_data_pkey PRIMARY KEY (user_id);
alter table public.immo_users add constraint immo_users_pkey PRIMARY KEY (email);
alter table public.immo_verify_views add constraint immo_verify_views_pkey PRIMARY KEY (id);
alter table public.immo_veto_events add constraint immo_veto_events_pkey PRIMARY KEY (id);
alter table public.immo_veto_findings add constraint immo_veto_findings_pkey PRIMARY KEY (id);
alter table public.immo_webhook_log add constraint immo_webhook_log_pkey PRIMARY KEY (id);
alter table public.immo_zugang add constraint immo_zugang_pkey PRIMARY KEY (email);
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.property_documents add constraint property_documents_pkey PRIMARY KEY (id);
alter table public.rt_admin_sessions add constraint rt_admin_sessions_pkey PRIMARY KEY (token_hash);
alter table public.rt_admins add constraint rt_admins_pkey PRIMARY KEY (email);
alter table public.rt_config add constraint rt_config_pkey PRIMARY KEY (key);
alter table public.rt_login_attempts add constraint rt_login_attempts_pkey PRIMARY KEY (id);
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_owner_id_key UNIQUE (owner_id);
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_slug_key UNIQUE (slug);
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_customer_number_key UNIQUE (customer_number);
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_widget_key_key UNIQUE (widget_key);
alter table public.immo_b2b_clients add constraint immo_b2b_clients_token_hash_key UNIQUE (token_hash);
alter table public.immo_b2b_invites add constraint immo_b2b_invites_token_hash_key UNIQUE (token_hash);
alter table public.immo_bank_package_sections add constraint immo_bank_package_sections_package_id_section_key_key UNIQUE (package_id, section_key);
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_package_id_version_no_key UNIQUE (package_id, version_no);
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_storage_bucket_storage_path_key UNIQUE (storage_bucket, storage_path);
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_package_id_sha256_hex_key UNIQUE (package_id, sha256_hex);
alter table public.immo_bank_share_links add constraint immo_bank_share_links_token_hash_key UNIQUE (token_hash);
alter table public.immo_campaigns add constraint immo_campaigns_slug_key UNIQUE (slug);
alter table public.immo_client_errors add constraint immo_client_errors_fingerprint_key UNIQUE (fingerprint);
alter table public.immo_data_room_shares add constraint immo_data_room_shares_token_hash_key UNIQUE (token_hash);
alter table public.immo_invites add constraint immo_invites_code_hash_key UNIQUE (code_hash);
alter table public.immo_invoices add constraint immo_invoices_invoice_number_key UNIQUE (invoice_number);
alter table public.immo_invoices add constraint immo_invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_owner_id_object_ref_version_no_key UNIQUE (owner_id, object_ref, version_no);
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_storage_path_key UNIQUE (storage_path);
alter table public.immo_newsletter add constraint immo_newsletter_email_key UNIQUE (email);
alter table public.immo_stress_scenarios add constraint immo_stress_scenarios_underwriting_case_id_scenario_key UNIQUE (underwriting_case_id, scenario);
alter table public.evidence_refs add constraint evidence_refs_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public.immo_analytics add constraint immo_analytics_med_check CHECK (((med IS NULL) OR (char_length(med) <= 40)));
alter table public.immo_analytics add constraint immo_analytics_ref_check CHECK (((ref IS NULL) OR (char_length(ref) <= 80)));
alter table public.immo_analytics add constraint immo_analytics_src_check CHECK (((src IS NULL) OR (char_length(src) <= 60)));
alter table public.immo_analytics add constraint immo_analytics_ev_check CHECK ((ev ~ '^[a-z_]{2,24}$'::text));
alter table public.immo_analytics add constraint immo_analytics_seg_check CHECK ((seg = ANY (ARRAY['b2c'::text, 'b2b'::text])));
alter table public.immo_analytics add constraint immo_analytics_device_check CHECK (((device IS NULL) OR (device = ANY (ARRAY['mobile'::text, 'tablet'::text, 'desktop'::text]))));
alter table public.immo_analytics add constraint immo_analytics_plan_check CHECK (((plan IS NULL) OR (char_length(plan) <= 40)));
alter table public.immo_analytics add constraint immo_analytics_visitor_check CHECK (((visitor IS NULL) OR (visitor ~ '^[0-9a-f]{16}$'::text)));
alter table public.immo_analytics add constraint immo_analytics_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)));
alter table public.immo_analytics add constraint immo_analytics_browser_check CHECK (((browser IS NULL) OR (char_length(browser) <= 20)));
alter table public.immo_analytics add constraint immo_analytics_camp_check CHECK (((camp IS NULL) OR (char_length(camp) <= 60)));
alter table public.immo_analytics add constraint immo_analytics_path_check CHECK (((path IS NULL) OR (char_length(path) <= 160)));
alter table public.immo_analytics add constraint immo_analytics_city_check CHECK (((city IS NULL) OR (char_length(city) <= 80)));
alter table public.immo_analytics add constraint immo_analytics_os_check CHECK (((os IS NULL) OR (char_length(os) <= 20)));
alter table public.immo_analytics add constraint immo_analytics_region_check CHECK (((region IS NULL) OR (char_length(region) <= 60)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_institution_type_check CHECK ((institution_type = ANY (ARRAY['BANK'::text, 'BROKER'::text, 'REALTOR'::text, 'OTHER'::text])));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_email_check CHECK ((char_length(email) <= 200));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_doc_title_check CHECK (((doc_title IS NULL) OR (char_length(doc_title) <= 80)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_doc_sender_check CHECK (((doc_sender IS NULL) OR (char_length(doc_sender) <= 160)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_doc_footer_check CHECK (((doc_footer IS NULL) OR (char_length(doc_footer) <= 400)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_custom_disclaimer_check CHECK (((custom_disclaimer IS NULL) OR (char_length(custom_disclaimer) <= 600)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_company_name_check CHECK (((char_length(company_name) >= 2) AND (char_length(company_name) <= 160)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_city_check CHECK (((char_length(city) >= 2) AND (char_length(city) <= 80)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_brand_font_check CHECK (((brand_font IS NULL) OR (brand_font = ANY (ARRAY['sans'::text, 'serif'::text, 'klassisch'::text]))));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_brand_color_check CHECK (((brand_color IS NULL) OR (brand_color ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_brand_color2_check CHECK (((brand_color2 IS NULL) OR (brand_color2 ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_booking_url_check CHECK (((booking_url IS NULL) OR (booking_url ~ '^https://'::text)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_billing_interval_check CHECK (((billing_interval IS NULL) OR (billing_interval = ANY (ARRAY['month'::text, 'year'::text]))));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_advisor_name_check CHECK (((char_length(advisor_name) >= 2) AND (char_length(advisor_name) <= 120)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_dossier_bonus_check CHECK ((dossier_bonus >= 0));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_referral_check CHECK (((referral IS NULL) OR (char_length(referral) <= 40)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_slug_check CHECK (((slug IS NULL) OR (slug ~ '^[a-z0-9-]{3,40}$'::text)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'locked'::text])));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_postal_code_check CHECK ((postal_code ~ '^[0-9]{5}$'::text));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_street_check CHECK (((street IS NULL) OR (char_length(street) <= 160)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['BASIC'::text, 'PRO'::text, 'ENTERPRISE'::text])));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_tax_id_check CHECK (((tax_id IS NULL) OR (char_length(tax_id) <= 40)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_plan_source_check CHECK ((plan_source = ANY (ARRAY['stripe'::text, 'manual'::text])));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_verification_note_check CHECK (((verification_note IS NULL) OR (char_length(verification_note) <= 600)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_verification_status_check CHECK ((verification_status = ANY (ARRAY['offen'::text, 'eingereicht'::text, 'geprueft'::text, 'abgelehnt'::text])));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_webhook_url_check CHECK (((webhook_url IS NULL) OR ((webhook_url ~ '^https://'::text) AND (char_length(webhook_url) <= 300))));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_payment_terms_days_check CHECK (((payment_terms_days >= 0) AND (payment_terms_days <= 90)));
alter table public.immo_b2b_accounts add constraint immo_b2b_ident CHECK (((COALESCE(register_number, ''::text) <> ''::text) OR (COALESCE(tax_id, ''::text) <> ''::text)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_legal_form_check CHECK (((char_length(legal_form) >= 1) AND (char_length(legal_form) <= 60)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_lead_retention_months_check CHECK (((lead_retention_months >= 1) AND (lead_retention_months <= 120)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_invoice_limit_cents_check CHECK (((invoice_limit_cents IS NULL) OR (invoice_limit_cents >= 0)));
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_register_number_check CHECK (((register_number IS NULL) OR (char_length(register_number) <= 60)));
alter table public.immo_b2b_clients add constraint immo_b2b_clients_status_check CHECK ((status = ANY (ARRAY['eingeladen'::text, 'verbunden'::text, 'getrennt'::text])));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_register_number_check CHECK (((register_number IS NULL) OR (char_length(register_number) <= 60)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_proof_name_check CHECK (((proof_name IS NULL) OR (char_length(proof_name) <= 140)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_proof_kind_check CHECK (((proof_kind IS NULL) OR (proof_kind = ANY (ARRAY['gewerbe'::text, 'handelsregister'::text, 'erlaubnis'::text, 'sonstiges'::text]))));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_legal_form_check CHECK (((legal_form IS NULL) OR (char_length(legal_form) <= 60)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_kind_check CHECK ((kind = ANY (ARRAY['demo'::text, 'enterprise'::text, 'kooperation'::text, 'konto'::text])));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_email_check CHECK ((char_length(email) <= 200));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_company_check CHECK (((char_length(company) >= 2) AND (char_length(company) <= 160)));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'erledigt'::text])));
alter table public.immo_b2b_contact add constraint immo_b2b_contact_tax_id_check CHECK (((tax_id IS NULL) OR (char_length(tax_id) <= 40)));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_client_email_check CHECK ((char_length(client_email) <= 200));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_client_name_check CHECK (((char_length(client_name) >= 2) AND (char_length(client_name) <= 120)));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_client_phone_check CHECK (((client_phone IS NULL) OR (char_length(client_phone) <= 40)));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000)));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000)));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_source_check CHECK ((source = ANY (ARRAY['widget'::text, 'landing'::text, 'qr'::text])));
alter table public.immo_b2b_leads add constraint immo_b2b_leads_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'in_bearbeitung'::text, 'abgeschlossen'::text, 'abgelehnt'::text])));
alter table public.immo_b2b_members add constraint immo_b2b_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'advisor'::text])));
alter table public.immo_b2b_partner_codes add constraint immo_b2b_partner_codes_code_check CHECK ((code ~ '^[A-Z0-9-]{3,30}$'::text));
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000)));
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_status_check CHECK ((status = ANY (ARRAY['eingegangen'::text, 'in_pruefung'::text, 'rueckfrage'::text, 'abgeschlossen'::text, 'abgelehnt'::text])));
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_reply_check CHECK (((reply IS NULL) OR (char_length(reply) <= 1000)));
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_object_label_check CHECK (((object_label IS NULL) OR (char_length(object_label) <= 160)));
alter table public.immo_b2b_usage add constraint immo_b2b_usage_month_check CHECK ((month ~ '^[0-9]{4}-[0-9]{2}$'::text));
alter table public.immo_b2b_usage add constraint immo_b2b_usage_kind_check CHECK ((kind = ANY (ARRAY['fall'::text, 'praesentation'::text])));
alter table public.immo_b2b_usage add constraint immo_b2b_usage_n_check CHECK ((n >= 0));
alter table public.immo_b2b_verification_docs add constraint immo_b2b_verification_docs_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 10485760)));
alter table public.immo_b2b_verification_docs add constraint immo_b2b_verification_docs_file_name_check CHECK ((char_length(file_name) <= 160));
alter table public.immo_b2b_verification_docs add constraint immo_b2b_verification_docs_kind_check CHECK ((kind = ANY (ARRAY['gewerbe'::text, 'handelsregister'::text, 'erlaubnis'::text, 'sonstiges'::text])));
alter table public.immo_bank_package_sections add constraint immo_bank_package_sections_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'blocked'::text])));
alter table public.immo_bank_pdf_audit add constraint immo_bank_pdf_audit_event_type_check CHECK ((event_type = ANY (ARRAY['generated'::text, 'downloaded'::text, 'shared'::text, 'revoked'::text])));
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_byte_size_check CHECK ((byte_size > 0));
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_sha256_hex_check CHECK ((sha256_hex ~ '^[0-9a-f]{64}$'::text));
alter table public.immo_bank_ready_scores add constraint immo_bank_ready_scores_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)));
alter table public.immo_bank_share_events add constraint immo_bank_share_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'opened'::text, 'downloaded'::text, 'revoked'::text, 'expired'::text, 'denied'::text])));
alter table public.immo_bank_share_links add constraint immo_bank_share_links_check CHECK ((expires_at > created_at));
alter table public.immo_bank_share_links add constraint immo_bank_share_links_use_count_check CHECK ((use_count >= 0));
alter table public.immo_bank_share_links add constraint immo_bank_share_links_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));
alter table public.immo_bank_share_links add constraint immo_bank_share_links_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0)));
alter table public.immo_bank_share_links add constraint immo_bank_share_links_failed_attempts_check CHECK ((failed_attempts >= 0));
alter table public.immo_campaigns add constraint immo_campaigns_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120)));
alter table public.immo_campaigns add constraint immo_campaigns_target_path_check CHECK ((target_path ~ '^/[a-z0-9/_-]*$'::text));
alter table public.immo_campaigns add constraint immo_campaigns_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,40}$'::text));
alter table public.immo_campaigns add constraint immo_campaigns_segment_check CHECK ((segment = ANY (ARRAY['b2b'::text, 'b2c'::text])));
alter table public.immo_campaigns add constraint immo_campaigns_channel_check CHECK ((channel = ANY (ARRAY['brief'::text, 'qr'::text, 'link'::text, 'newsletter'::text, 'social'::text, 'anzeige'::text, 'messe'::text])));
alter table public.immo_campaigns add constraint immo_campaigns_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 1000)));
alter table public.immo_crm_activities add constraint immo_crm_activities_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000)));
alter table public.immo_crm_activities add constraint immo_crm_activities_type_check CHECK ((type = ANY (ARRAY['brief'::text, 'anruf'::text, 'email'::text, 'linkedin'::text, 'termin'::text, 'notiz'::text, 'status'::text])));
alter table public.immo_crm_activities add constraint immo_crm_activities_campaign_check CHECK (((campaign IS NULL) OR (char_length(campaign) <= 60)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_website_check CHECK (((website IS NULL) OR (char_length(website) <= 300)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_branch_check CHECK (((branch IS NULL) OR (char_length(branch) <= 120)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_street_check CHECK (((street IS NULL) OR (char_length(street) <= 160)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'vermittler'::text, 'makler'::text, 'finanzberater'::text, 'sonstige'::text])));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_city_check CHECK (((city IS NULL) OR (char_length(city) <= 80)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_company_check CHECK (((char_length(company) >= 2) AND (char_length(company) <= 160)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_contact_name_check CHECK (((contact_name IS NULL) OR (char_length(contact_name) <= 120)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'angeschrieben'::text, 'angerufen'::text, 'interesse'::text, 'termin'::text, 'kunde'::text, 'kein_interesse'::text, 'widerspruch'::text])));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_email_check CHECK (((email IS NULL) OR (char_length(email) <= 200)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_source_check CHECK (((char_length(source) >= 3) AND (char_length(source) <= 300)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_salutation_check CHECK (((salutation IS NULL) OR (salutation = ANY (ARRAY['Frau'::text, 'Herr'::text, ''::text]))));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_role_check CHECK (((role IS NULL) OR (char_length(role) <= 120)));
alter table public.immo_crm_contacts add constraint immo_crm_contacts_postal_code_check CHECK (((postal_code IS NULL) OR (postal_code ~ '^[0-9]{5}$'::text)));
alter table public.immo_document_ingestion_jobs add constraint immo_document_ingestion_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'hashing'::text, 'classified'::text, 'ocr'::text, 'extracted'::text, 'validated'::text, 'completed'::text, 'failed'::text])));
alter table public.immo_document_requests add constraint immo_document_requests_note_check CHECK ((char_length(note) <= 300));
alter table public.immo_document_requests add constraint immo_document_requests_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'erledigt'::text])));
alter table public.immo_document_requests add constraint immo_document_requests_category_check CHECK ((category = ANY (ARRAY['objekt'::text, 'miete'::text, 'weg'::text, 'grundbuch'::text, 'technik'::text, 'finanzen'::text, 'steuer'::text])));
alter table public.immo_documents add constraint immo_documents_category_chk CHECK (((category IS NULL) OR (category = ANY (ARRAY['objekt'::text, 'miete'::text, 'weg'::text, 'grundbuch'::text, 'technik'::text, 'finanzen'::text, 'steuer'::text]))));
alter table public.immo_entitlements add constraint immo_entitlements_plan_check CHECK ((plan = ANY (ARRAY['analysis'::text, 'creditmap'::text, 'pro'::text])));
alter table public.immo_entitlements add constraint immo_entitlements_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'trial'::text])));
alter table public.immo_invoices add constraint immo_invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['STRIPE_CARD'::text, 'SEPA_B2B'::text, 'INVOICE_BANK_TRANSFER'::text])));
alter table public.immo_invoices add constraint immo_invoices_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'stripe'::text])));
alter table public.immo_invoices add constraint immo_invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'storno'::text, 'credit'::text])));
alter table public.immo_invoices add constraint immo_invoices_payment_status_check CHECK ((payment_status = ANY (ARRAY['PAID'::text, 'PENDING'::text, 'OVERDUE'::text, 'CANCELLED'::text])));
alter table public.immo_kreditmappe_credits add constraint immo_kreditmappe_credits_object_ref_check CHECK ((object_ref ~ '^[A-Za-z0-9_-]{4,40}$'::text));
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_byte_size_check CHECK ((byte_size > 0));
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text));
alter table public.immo_newsletter add constraint immo_newsletter_source_check CHECK (((source IS NULL) OR (char_length(source) <= 60)));
alter table public.immo_newsletter add constraint immo_newsletter_email_check CHECK ((char_length(email) <= 200));
alter table public.immo_newsletter add constraint immo_newsletter_name_check CHECK (((name IS NULL) OR (char_length(name) <= 120)));
alter table public.immo_newsletter add constraint immo_newsletter_company_check CHECK (((company IS NULL) OR (char_length(company) <= 160)));
alter table public.immo_newsletter add constraint immo_newsletter_segment_check CHECK ((segment = ANY (ARRAY['b2b'::text, 'b2c'::text])));
alter table public.immo_newsletter_sends add constraint immo_newsletter_sends_subject_check CHECK ((char_length(subject) <= 160));
alter table public.immo_newsletter_sends add constraint immo_newsletter_sends_body_check CHECK ((char_length(body) <= 20000));
alter table public.immo_partners add constraint immo_partners_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,40}$'::text));
alter table public.immo_partners add constraint immo_partners_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120)));
alter table public.immo_partners add constraint immo_partners_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'berater'::text, 'sonstige'::text])));
alter table public.immo_records add constraint immo_records_kind_check CHECK ((kind = ANY (ARRAY['objekt'::text, 'profil'::text])));
alter table public.immo_security_blocks add constraint immo_security_blocks_ip_hash_check CHECK ((ip_hash ~ '^[0-9a-f]{32}$'::text));
alter table public.immo_security_blocks add constraint immo_security_blocks_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 200)));
alter table public.immo_security_log add constraint immo_security_log_ip_hash_check CHECK (((ip_hash IS NULL) OR (ip_hash ~ '^[0-9a-f]{32}$'::text)));
alter table public.immo_security_log add constraint immo_security_log_kind_check CHECK ((kind = ANY (ARRAY['rate_limit'::text, 'admin_denied'::text, 'admin_ip_blocked'::text, 'admin_mfa_missing'::text, 'panic'::text, 'honeypot'::text, 'too_fast'::text, 'disposable_email'::text, 'email_no_mx'::text, 'content_flagged'::text, 'probe'::text, 'blocked'::text, 'login_flood'::text, 'upload_rejected'::text, 'invoice_tampered'::text])));
alter table public.immo_security_log add constraint immo_security_log_detail_check CHECK (((detail IS NULL) OR (char_length(detail) <= 160)));
alter table public.immo_suppression add constraint immo_suppression_kind_check CHECK ((kind = ANY (ARRAY['email'::text, 'firma'::text])));
alter table public.immo_veto_findings add constraint immo_veto_findings_veto_level_check CHECK ((veto_level = ANY (ARRAY['HARD_VETO'::text, 'CONDITIONAL_VETO'::text, 'WARNING'::text])));
alter table public.immo_zugang add constraint immo_zugang_email_check CHECK ((email = lower(email)));
alter table public.immo_zugang add constraint immo_zugang_objekt_guthaben_check CHECK ((objekt_guthaben >= 0));
alter table public.evidence_refs add constraint evidence_refs_document_id_fkey FOREIGN KEY (document_id) REFERENCES property_documents(id) ON DELETE CASCADE;
alter table public.immo_access_audit add constraint immo_access_audit_document_id_fkey FOREIGN KEY (document_id) REFERENCES immo_documents(id) ON DELETE SET NULL;
alter table public.immo_access_audit add constraint immo_access_audit_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.immo_access_audit add constraint immo_access_audit_share_id_fkey FOREIGN KEY (share_id) REFERENCES immo_data_room_shares(id) ON DELETE SET NULL;
alter table public.immo_access_audit add constraint immo_access_audit_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE SET NULL;
alter table public.immo_b2b_accounts add constraint immo_b2b_accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_b2b_clients add constraint immo_b2b_clients_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_invites add constraint immo_b2b_invites_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_leads add constraint immo_b2b_leads_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_leads add constraint immo_b2b_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.immo_b2b_members add constraint immo_b2b_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_b2b_members add constraint immo_b2b_members_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_submissions add constraint immo_b2b_submissions_version_id_fkey FOREIGN KEY (version_id) REFERENCES immo_kreditmappe_versions(id) ON DELETE SET NULL;
alter table public.immo_b2b_usage add constraint immo_b2b_usage_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_b2b_verification_docs add constraint immo_b2b_verification_docs_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.immo_bank_package_sections add constraint immo_bank_package_sections_package_id_fkey FOREIGN KEY (package_id) REFERENCES immo_bank_packages(id) ON DELETE CASCADE;
alter table public.immo_bank_packages add constraint immo_bank_packages_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE CASCADE;
alter table public.immo_bank_packages add constraint immo_bank_packages_qr_share_id_fkey FOREIGN KEY (qr_share_id) REFERENCES immo_data_room_shares(id);
alter table public.immo_bank_packages add constraint immo_bank_packages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_bank_pdf_audit add constraint immo_bank_pdf_audit_package_id_fkey FOREIGN KEY (package_id) REFERENCES immo_bank_packages(id) ON DELETE RESTRICT;
alter table public.immo_bank_pdf_audit add constraint immo_bank_pdf_audit_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES immo_bank_pdf_versions(id) ON DELETE RESTRICT;
alter table public.immo_bank_pdf_versions add constraint immo_bank_pdf_versions_package_id_fkey FOREIGN KEY (package_id) REFERENCES immo_bank_packages(id) ON DELETE RESTRICT;
alter table public.immo_bank_ready_scores add constraint immo_bank_ready_scores_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.immo_bank_ready_scores add constraint immo_bank_ready_scores_underwriting_case_id_fkey FOREIGN KEY (underwriting_case_id) REFERENCES immo_underwriting_cases(id) ON DELETE CASCADE;
alter table public.immo_bank_share_events add constraint immo_bank_share_events_package_id_fkey FOREIGN KEY (package_id) REFERENCES immo_bank_packages(id) ON DELETE RESTRICT;
alter table public.immo_bank_share_events add constraint immo_bank_share_events_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES immo_bank_pdf_versions(id) ON DELETE RESTRICT;
alter table public.immo_bank_share_events add constraint immo_bank_share_events_share_link_id_fkey FOREIGN KEY (share_link_id) REFERENCES immo_bank_share_links(id) ON DELETE RESTRICT;
alter table public.immo_bank_share_events add constraint immo_bank_share_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public.immo_bank_share_links add constraint immo_bank_share_links_package_id_fkey FOREIGN KEY (package_id) REFERENCES immo_bank_packages(id) ON DELETE RESTRICT;
alter table public.immo_bank_share_links add constraint immo_bank_share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.immo_bank_share_links add constraint immo_bank_share_links_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES immo_bank_pdf_versions(id) ON DELETE RESTRICT;
alter table public.immo_crm_activities add constraint immo_crm_activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES immo_crm_contacts(id) ON DELETE CASCADE;
alter table public.immo_crm_contacts add constraint immo_crm_contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE SET NULL;
alter table public.immo_data_room_access_log add constraint immo_data_room_access_log_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE SET NULL;
alter table public.immo_data_room_access_log add constraint immo_data_room_access_log_share_id_fkey FOREIGN KEY (share_id) REFERENCES immo_data_room_shares(id) ON DELETE SET NULL;
alter table public.immo_data_room_access_log add constraint immo_data_room_access_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.immo_data_room_access_log add constraint immo_data_room_access_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES immo_documents(id) ON DELETE SET NULL;
alter table public.immo_data_room_shares add constraint immo_data_room_shares_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE CASCADE;
alter table public.immo_data_room_shares add constraint immo_data_room_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_deals add constraint immo_deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_decision_scenarios add constraint immo_decision_scenarios_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.immo_document_events add constraint immo_document_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_document_events add constraint immo_document_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES immo_documents(id) ON DELETE CASCADE;
alter table public.immo_document_ingestion_jobs add constraint immo_document_ingestion_jobs_document_id_fkey FOREIGN KEY (document_id) REFERENCES immo_documents(id) ON DELETE CASCADE;
alter table public.immo_document_ingestion_jobs add constraint immo_document_ingestion_jobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_document_requests add constraint immo_document_requests_share_id_fkey FOREIGN KEY (share_id) REFERENCES immo_data_room_shares(id) ON DELETE CASCADE;
alter table public.immo_documents add constraint immo_documents_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE CASCADE;
alter table public.immo_documents add constraint immo_documents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_entitlements add constraint immo_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_evidence add constraint immo_evidence_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE CASCADE;
alter table public.immo_invoices add constraint immo_invoices_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE SET NULL;
alter table public.immo_invoices add constraint immo_invoices_refers_to_fkey FOREIGN KEY (refers_to) REFERENCES immo_invoices(id);
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_kreditmappe_versions add constraint immo_kreditmappe_versions_b2b_account_id_fkey FOREIGN KEY (b2b_account_id) REFERENCES immo_b2b_accounts(id) ON DELETE SET NULL;
alter table public.immo_newsletter_deliveries add constraint immo_newsletter_deliveries_send_id_fkey FOREIGN KEY (send_id) REFERENCES immo_newsletter_sends(id) ON DELETE CASCADE;
alter table public.immo_newsletter_deliveries add constraint immo_newsletter_deliveries_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES immo_newsletter(id) ON DELETE SET NULL;
alter table public.immo_reminder_log add constraint immo_reminder_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_sessions add constraint immo_sessions_email_fkey FOREIGN KEY (email) REFERENCES immo_users(email) ON DELETE CASCADE;
alter table public.immo_stress_scenarios add constraint immo_stress_scenarios_underwriting_case_id_fkey FOREIGN KEY (underwriting_case_id) REFERENCES immo_underwriting_cases(id) ON DELETE CASCADE;
alter table public.immo_underwriting_cases add constraint immo_underwriting_cases_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.immo_user_data add constraint immo_user_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.immo_verify_views add constraint immo_verify_views_b2b_account_id_fkey FOREIGN KEY (b2b_account_id) REFERENCES immo_b2b_accounts(id) ON DELETE SET NULL;
alter table public.immo_veto_events add constraint immo_veto_events_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES immo_deals(id) ON DELETE CASCADE;
alter table public.immo_veto_findings add constraint immo_veto_findings_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.immo_webhook_log add constraint immo_webhook_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES immo_b2b_accounts(id) ON DELETE CASCADE;
alter table public.property_documents add constraint property_documents_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.rt_admin_sessions add constraint rt_admin_sessions_email_fkey FOREIGN KEY (email) REFERENCES rt_admins(email) ON DELETE CASCADE;

-- ===================== Indexes =====================
CREATE INDEX evidence_refs_document_idx ON public.evidence_refs USING btree (document_id);
CREATE INDEX evidence_refs_document_id_idx ON public.evidence_refs USING btree (document_id);
CREATE INDEX evidence_refs_status_idx ON public.evidence_refs USING btree (status);
CREATE INDEX idx_immo_audit_deal ON public.immo_access_audit USING btree (deal_id);
CREATE INDEX immo_access_audit_deal_id_idx ON public.immo_access_audit USING btree (deal_id);
CREATE INDEX immo_access_audit_document_id_idx ON public.immo_access_audit USING btree (document_id);
CREATE INDEX immo_access_audit_share_id_idx ON public.immo_access_audit USING btree (share_id);
CREATE INDEX immo_access_audit_owner_id_idx ON public.immo_access_audit USING btree (owner_id);
CREATE INDEX idx_admin_audit_time ON public.immo_admin_audit USING btree (created_at DESC);
CREATE INDEX immo_analytics_seg_ev_ts ON public.immo_analytics USING btree (seg, ev, ts);
CREATE INDEX immo_analytics_ts ON public.immo_analytics USING btree (ts);
CREATE INDEX immo_audit_created_idx ON public.immo_audit_log USING btree (created_at DESC);
CREATE INDEX immo_b2b_clients_account_idx ON public.immo_b2b_clients USING btree (account_id);
CREATE UNIQUE INDEX immo_b2b_clients_unique_active ON public.immo_b2b_clients USING btree (account_id, client_user_id) WHERE (status = 'verbunden'::text);
CREATE INDEX immo_b2b_clients_user_idx ON public.immo_b2b_clients USING btree (client_user_id);
CREATE INDEX immo_b2b_invites_account ON public.immo_b2b_invites USING btree (account_id);
CREATE INDEX idx_b2bleads_assigned ON public.immo_b2b_leads USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX idx_b2bleads_account_date ON public.immo_b2b_leads USING btree (account_id, created_at DESC);
CREATE UNIQUE INDEX immo_b2b_members_user ON public.immo_b2b_members USING btree (user_id);
CREATE INDEX idx_sub_to ON public.immo_b2b_submissions USING btree (to_account_id, created_at DESC);
CREATE INDEX idx_sub_version ON public.immo_b2b_submissions USING btree (version_id);
CREATE INDEX idx_sub_from ON public.immo_b2b_submissions USING btree (from_account_id, created_at DESC);
CREATE INDEX idx_sub_from_user ON public.immo_b2b_submissions USING btree (from_user_id);
CREATE INDEX immo_b2b_verification_docs_account_idx ON public.immo_b2b_verification_docs USING btree (account_id);
CREATE INDEX immo_bank_package_sections_package_id_idx ON public.immo_bank_package_sections USING btree (package_id);
CREATE INDEX idx_bank_sections_package_order ON public.immo_bank_package_sections USING btree (package_id, page_order);
CREATE INDEX immo_bank_packages_qr_share_id_idx ON public.immo_bank_packages USING btree (qr_share_id);
CREATE INDEX immo_bank_packages_owner_id_idx ON public.immo_bank_packages USING btree (owner_id);
CREATE INDEX idx_immo_bank_packages_deal ON public.immo_bank_packages USING btree (deal_id, created_at DESC);
CREATE INDEX immo_bank_packages_deal_id_idx ON public.immo_bank_packages USING btree (deal_id);
CREATE INDEX idx_bank_pdf_audit_version_created ON public.immo_bank_pdf_audit USING btree (pdf_version_id, created_at DESC);
CREATE INDEX immo_bank_pdf_audit_pdf_version_id_idx ON public.immo_bank_pdf_audit USING btree (pdf_version_id);
CREATE INDEX immo_bank_pdf_audit_package_id_idx ON public.immo_bank_pdf_audit USING btree (package_id);
CREATE INDEX immo_bank_pdf_versions_package_id_idx ON public.immo_bank_pdf_versions USING btree (package_id);
CREATE INDEX idx_bank_pdf_versions_package_created ON public.immo_bank_pdf_versions USING btree (package_id, created_at DESC);
CREATE INDEX immo_bank_ready_scores_underwriting_case_id_idx ON public.immo_bank_ready_scores USING btree (underwriting_case_id);
CREATE INDEX immo_bank_ready_scores_property_id_idx ON public.immo_bank_ready_scores USING btree (property_id);
CREATE INDEX immo_bank_score_property_idx ON public.immo_bank_ready_scores USING btree (property_id);
CREATE INDEX immo_bank_share_events_pdf_version_id_idx ON public.immo_bank_share_events USING btree (pdf_version_id);
CREATE INDEX idx_bank_share_events_link_created ON public.immo_bank_share_events USING btree (share_link_id, created_at DESC);
CREATE INDEX immo_bank_share_events_share_link_id_idx ON public.immo_bank_share_events USING btree (share_link_id);
CREATE INDEX immo_bank_share_events_package_id_idx ON public.immo_bank_share_events USING btree (package_id);
CREATE INDEX immo_bank_share_events_actor_id_idx ON public.immo_bank_share_events USING btree (actor_id);
CREATE INDEX immo_bank_share_links_created_by_idx ON public.immo_bank_share_links USING btree (created_by);
CREATE INDEX idx_bank_share_links_token_expires ON public.immo_bank_share_links USING btree (token_hash, expires_at);
CREATE INDEX immo_bank_share_links_package_id_idx ON public.immo_bank_share_links USING btree (package_id);
CREATE INDEX immo_bank_share_links_pdf_version_id_idx ON public.immo_bank_share_links USING btree (pdf_version_id);
CREATE INDEX immo_client_errors_last_idx ON public.immo_client_errors USING btree (last_seen DESC);
CREATE INDEX immo_crm_activities_contact ON public.immo_crm_activities USING btree (contact_id, at DESC);
CREATE INDEX immo_crm_contacts_account_idx ON public.immo_crm_contacts USING btree (account_id);
CREATE INDEX immo_crm_contacts_status ON public.immo_crm_contacts USING btree (status, next_at);
CREATE INDEX immo_data_room_access_log_share_id_idx ON public.immo_data_room_access_log USING btree (share_id);
CREATE INDEX immo_data_room_access_log_owner_id_idx ON public.immo_data_room_access_log USING btree (owner_id);
CREATE INDEX immo_data_room_access_log_document_id_idx ON public.immo_data_room_access_log USING btree (document_id);
CREATE INDEX idx_immo_room_access_share ON public.immo_data_room_access_log USING btree (share_id, created_at DESC);
CREATE INDEX immo_data_room_access_log_deal_id_idx ON public.immo_data_room_access_log USING btree (deal_id);
CREATE INDEX immo_shares_owner_idx ON public.immo_data_room_shares USING btree (owner_id, created_at DESC);
CREATE INDEX immo_data_room_shares_deal_id_idx ON public.immo_data_room_shares USING btree (deal_id);
CREATE INDEX immo_data_room_shares_owner_id_idx ON public.immo_data_room_shares USING btree (owner_id);
CREATE INDEX immo_deals_owner_id_idx ON public.immo_deals USING btree (owner_id);
CREATE INDEX immo_decision_scenario_property_idx ON public.immo_decision_scenarios USING btree (property_id);
CREATE INDEX immo_decision_scenarios_property_id_idx ON public.immo_decision_scenarios USING btree (property_id);
CREATE INDEX immo_document_events_owner_id_idx ON public.immo_document_events USING btree (owner_id);
CREATE INDEX immo_document_events_document_id_idx ON public.immo_document_events USING btree (document_id);
CREATE INDEX idx_immo_document_events_doc ON public.immo_document_events USING btree (document_id, created_at DESC);
CREATE INDEX immo_document_ingestion_jobs_document_id_idx ON public.immo_document_ingestion_jobs USING btree (document_id);
CREATE INDEX idx_immo_ingestion_owner ON public.immo_document_ingestion_jobs USING btree (owner_id, created_at DESC);
CREATE INDEX idx_immo_ingestion_document ON public.immo_document_ingestion_jobs USING btree (document_id);
CREATE INDEX immo_document_ingestion_jobs_owner_id_idx ON public.immo_document_ingestion_jobs USING btree (owner_id);
CREATE UNIQUE INDEX immo_doc_requests_open_once ON public.immo_document_requests USING btree (share_id, category) WHERE (status = 'offen'::text);
CREATE INDEX immo_doc_requests_owner_idx ON public.immo_document_requests USING btree (owner_id, status, created_at DESC);
CREATE INDEX immo_documents_owner_id_idx ON public.immo_documents USING btree (owner_id);
CREATE INDEX immo_documents_owner_object_idx ON public.immo_documents USING btree (owner_id, object_ref);
CREATE INDEX immo_documents_deal_id_idx ON public.immo_documents USING btree (deal_id);
CREATE INDEX idx_immo_documents_deal ON public.immo_documents USING btree (deal_id);
CREATE INDEX immo_evidence_deal_id_idx ON public.immo_evidence USING btree (deal_id);
CREATE INDEX idx_invoices_account ON public.immo_invoices USING btree (account_id);
CREATE INDEX idx_invoices_period ON public.immo_invoices USING btree (issue_date, account_id);
CREATE INDEX idx_invoices_paid ON public.immo_invoices USING btree (paid_at);
CREATE INDEX idx_invoices_refers ON public.immo_invoices USING btree (refers_to);
CREATE INDEX immo_kaeufe_pi_idx ON public.immo_kaeufe USING btree (payment_intent);
CREATE INDEX idx_kmv_b2b_time ON public.immo_kreditmappe_versions USING btree (b2b_account_id, created_at DESC);
CREATE INDEX immo_km_versions_owner_idx ON public.immo_kreditmappe_versions USING btree (owner_id, object_ref, version_no DESC);
CREATE INDEX immo_newsletter_deliveries_subscriber_idx ON public.immo_newsletter_deliveries USING btree (subscriber_id);
CREATE INDEX immo_newsletter_deliveries_send_idx ON public.immo_newsletter_deliveries USING btree (send_id);
CREATE INDEX immo_records_owner_idx ON public.immo_records USING btree (owner_email, kind, deleted, updated_at DESC);
CREATE INDEX immo_security_log_created ON public.immo_security_log USING btree (created_at DESC);
CREATE INDEX idx_seclog_time ON public.immo_security_log USING btree (created_at DESC);
CREATE INDEX immo_sessions_email_idx ON public.immo_sessions USING btree (email);
CREATE INDEX immo_stress_case_idx ON public.immo_stress_scenarios USING btree (underwriting_case_id);
CREATE INDEX immo_stress_scenarios_underwriting_case_id_idx ON public.immo_stress_scenarios USING btree (underwriting_case_id);
CREATE INDEX immo_underwriting_cases_deal_id_idx ON public.immo_underwriting_cases USING btree (deal_id);
CREATE INDEX immo_underwriting_cases_property_id_idx ON public.immo_underwriting_cases USING btree (property_id);
CREATE INDEX immo_underwriting_property_idx ON public.immo_underwriting_cases USING btree (property_id);
CREATE INDEX idx_verify_views_acc ON public.immo_verify_views USING btree (b2b_account_id);
CREATE INDEX idx_verify_views_time ON public.immo_verify_views USING btree (created_at DESC);
CREATE INDEX immo_veto_events_deal_id_idx ON public.immo_veto_events USING btree (deal_id);
CREATE INDEX idx_immo_veto_deal ON public.immo_veto_events USING btree (deal_id);
CREATE INDEX immo_veto_findings_property_id_idx ON public.immo_veto_findings USING btree (property_id);
CREATE INDEX immo_veto_property_idx ON public.immo_veto_findings USING btree (property_id);
CREATE INDEX idx_whlog_acc ON public.immo_webhook_log USING btree (account_id, created_at DESC);
CREATE INDEX immo_zugang_customer_idx ON public.immo_zugang USING btree (stripe_customer_id);
CREATE UNIQUE INDEX property_documents_sha256_idx ON public.property_documents USING btree (sha256);
CREATE INDEX property_documents_property_id_idx ON public.property_documents USING btree (property_id);
CREATE INDEX rt_admin_sessions_email_idx ON public.rt_admin_sessions USING btree (email);
CREATE INDEX rt_login_attempts_who_idx ON public.rt_login_attempts USING btree (who, created_at);

-- ===================== Functions =====================
CREATE OR REPLACE FUNCTION public.admin_analytics(seg_in text, days integer DEFAULT 30, admins text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with a as (select * from public.immo_analytics where seg = seg_in and ts > now() - make_interval(days => days)),
  pv as (select * from a where ev = 'pv'),
  prev as (select * from public.immo_analytics where seg = seg_in and ev = 'pv' and ts <= now() - make_interval(days => days) and ts > now() - make_interval(days => days * 2)),
  dayv as (select (ts at time zone 'Europe/Berlin')::date d, count(distinct visitor) v, count(*) p from pv group by 1),
  regs as (select count(*) n from auth.users au where au.created_at > now() - make_interval(days => days)
           and lower(coalesce(au.email,'')) <> all (select lower(x) from unnest(admins) x)
           and (case when seg_in = 'b2b' then coalesce(au.raw_user_meta_data->>'area','') = 'b2b' else coalesce(au.raw_user_meta_data->>'area','') <> 'b2b' end))
  select jsonb_build_object(
    'days', days,
    'visitors', (select coalesce(sum(v),0) from dayv),
    'pageviews', (select count(*) from pv),
    'prevVisitors', (select coalesce(sum(v),0) from (select count(distinct visitor) v from prev group by (ts at time zone 'Europe/Berlin')::date) x),
    'prevPageviews', (select count(*) from prev),
    'series', (select coalesce(jsonb_agg(jsonb_build_array(g::date, coalesce(dv.v,0), coalesce(dv.p,0)) order by g), '[]'::jsonb)
               from generate_series((now() at time zone 'Europe/Berlin')::date - (days - 1), (now() at time zone 'Europe/Berlin')::date, interval '1 day') g
               left join dayv dv on dv.d = g::date),
    'pages', (select coalesce(jsonb_agg(jsonb_build_array(path, n, v)), '[]'::jsonb) from (select path, count(*) n, count(distinct visitor) v from pv group by path order by 2 desc limit 15) x),
    'refs', (select coalesce(jsonb_agg(jsonb_build_array(r, n)), '[]'::jsonb) from (select coalesce(src, ref, 'Direkt / unbekannt') r, count(distinct visitor) n from pv group by 1 order by 2 desc limit 12) x),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_array(c, n)), '[]'::jsonb) from (select concat_ws(' / ', src, med, camp) c, count(distinct visitor) n from pv where camp is not null or med is not null group by 1 order by 2 desc limit 10) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_array(device, n)), '[]'::jsonb) from (select coalesce(device,'?') device, count(distinct visitor) n from pv group by 1 order by 2 desc) x),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_array(browser, n)), '[]'::jsonb) from (select coalesce(browser,'Sonstige') browser, count(distinct visitor) n from pv group by 1 order by 2 desc limit 8) x),
    'os', (select coalesce(jsonb_agg(jsonb_build_array(os, n)), '[]'::jsonb) from (select coalesce(os,'Sonstige') os, count(distinct visitor) n from pv group by 1 order by 2 desc limit 8) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_array(country, n)), '[]'::jsonb) from (select coalesce(country,'??') country, count(distinct visitor) n from pv group by 1 order by 2 desc limit 10) x),
    'events', (select coalesce(jsonb_object_agg(ev, n), '{}'::jsonb) from (select ev, count(*) n from a where ev <> 'pv' group by ev) x),
    'eventVisitors', (select coalesce(jsonb_object_agg(ev, n), '{}'::jsonb) from (select ev, count(distinct visitor) n from a where ev <> 'pv' and visitor is not null group by ev) x),
    'offerVisitors', (select count(distinct visitor) from pv where path in ('/angebote','/b2b') or path like '/angebote/%'),
    'registrations', (select n from regs),
    'purchases', (select count(*) from a where ev = 'purchase'),
    'revenueCents', null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_analytics_geo(seg_in text, days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pv as (select * from public.immo_analytics where seg = seg_in and ev = 'pv' and ts > now() - make_interval(days => days))
  select jsonb_build_object(
    'cities', (select coalesce(jsonb_agg(jsonb_build_array(c, r, k, n)), '[]'::jsonb) from (select city c, region r, country k, count(distinct visitor) n from pv where city is not null group by 1,2,3 order by 4 desc limit 25) x),
    'regions', (select coalesce(jsonb_agg(jsonb_build_array(r, k, n)), '[]'::jsonb) from (select region r, country k, count(distinct visitor) n from pv where region is not null group by 1,2 order by 3 desc limit 20) x)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_campaign_stats(days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_object_agg(camp, jsonb_build_object('visitors', v, 'pageviews', p, 'requests', r, 'registrations', g)), '{}'::jsonb) from (
    select camp, count(distinct visitor) filter (where ev = 'pv') v, count(*) filter (where ev = 'pv') p,
      count(*) filter (where ev in ('b2b_request','b2b_contact')) r, count(*) filter (where ev = 'register') g
    from public.immo_analytics where camp is not null and ts > now() - make_interval(days => days) group by camp) x;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_funnel(seg text, admins text[] DEFAULT '{}'::text[], days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b2b_users as (select distinct user_id from public.immo_b2b_members),
  u as (
    select au.id, au.created_at, au.email_confirmed_at from auth.users au
    where lower(coalesce(au.email, '')) <> all (select lower(x) from unnest(admins) x)
      and au.id not in (select user_id from b2b_users)
      and (days is null or au.created_at > now() - make_interval(days => days))
  ),
  d as (
    select u.*, ud.profile, ud.objects, ud.progress from u left join public.immo_user_data ud on ud.user_id = u.id
  ),
  acc as (
    select a.* from public.immo_b2b_accounts a where days is null or a.created_at > now() - make_interval(days => days)
  )
  select case when seg = 'b2b' then jsonb_build_object('seg', 'b2b', 'steps', jsonb_build_array(
      jsonb_build_array('Unternehmen registriert', (select count(*) from acc)),
      jsonb_build_array('Unterlagen eingereicht', (select count(*) from acc where verification_status in ('eingereicht', 'geprueft') or verified_at is not null)),
      jsonb_build_array('Verifiziert', (select count(*) from acc where verified_at is not null)),
      jsonb_build_array('Tarif gebucht', (select count(*) from acc where plan_tier is not null and (plan_until is null or plan_until > now()))),
      jsonb_build_array('Erste Anfrage erhalten', (select count(distinct l.account_id) from public.immo_b2b_leads l where l.account_id in (select id from acc))),
      jsonb_build_array('Kunde verbunden', (select count(distinct c.account_id) from public.immo_b2b_clients c where c.status = 'verbunden' and c.account_id in (select id from acc)))
    ))
  else jsonb_build_object('seg', 'b2c', 'steps', jsonb_build_array(
      jsonb_build_array('Registriert', (select count(*) from d)),
      jsonb_build_array('E-Mail bestätigt', (select count(*) from d where email_confirmed_at is not null)),
      jsonb_build_array('Eingerichtet (Assistent oder Modus)', (select count(*) from d where profile ? 'onboardedAt' or profile ? 'mode')),
      jsonb_build_array('Finanzprofil ausgefüllt', (select count(*) from d where coalesce(profile->>'netIncome', '') ~ '^[0-9]+(\.[0-9]+)?$' and (profile->>'netIncome')::numeric > 0)),
      jsonb_build_array('Objekt angelegt', (select count(*) from d where jsonb_typeof(objects) = 'array' and jsonb_array_length(objects) > 0)),
      jsonb_build_array('Bankreife ≥ 90 %', (select count(*) from d where coalesce(progress->'summary'->>'best', '') ~ '^[0-9]+$' and (progress->'summary'->>'best')::int >= 90)),
      jsonb_build_array('Tarif gebucht', (select count(*) from d where exists (select 1 from public.immo_entitlements e where e.user_id = d.id and e.status in ('active', 'trialing'))))
    ))
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_security_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null or phone_confirmed_at is not null),
    'mfaUsers', (select count(distinct user_id) from auth.mfa_factors where status = 'verified'),
    'mfaTotp', (select count(*) from auth.mfa_factors where status = 'verified' and factor_type = 'totp'),
    'mfaPhone', (select count(*) from auth.mfa_factors where status = 'verified' and factor_type = 'phone'),
    'activeSessions', (select count(*) from auth.sessions where (not_after is null or not_after > now()) and updated_at > now() - interval '30 days'),
    'aal2Sessions', (select count(*) from auth.sessions where aal = 'aal2' and updated_at > now() - interval '30 days'),
    'signIns24h', (select count(*) from auth.audit_log_entries where created_at > now() - interval '24 hours' and payload->>'action' in ('login', 'token_refreshed') and payload->>'action' = 'login'),
    'signIns7d', (select count(*) from auth.audit_log_entries where created_at > now() - interval '7 days' and payload->>'action' = 'login'),
    'recovery7d', (select count(*) from auth.audit_log_entries where created_at > now() - interval '7 days' and payload->>'action' in ('user_recovery_requested', 'recovery_requested')),
    'events', coalesce((select jsonb_agg(e order by e->>'at' desc) from (
        select jsonb_build_object(
          'at', a.created_at,
          'action', a.payload->>'action',
          'who', case when coalesce(a.payload->>'actor_username', '') like '%@%'
                   then left(a.payload->>'actor_username', 2) || '…@' || split_part(a.payload->>'actor_username', '@', 2)
                   else coalesce(nullif(a.payload->>'actor_username', ''), '–') end,
          'ip', case when a.ip_address ~ '^\d+\.\d+\.\d+\.\d+$' then regexp_replace(a.ip_address, '\.\d+$', '.x') else left(coalesce(a.ip_address, ''), 12) end
        ) as e
        from auth.audit_log_entries a
        where a.payload->>'action' not in ('token_refreshed', 'token_revoked')
        order by a.created_at desc limit 40) t), '[]'::jsonb),
    'blocked7d', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.immo_security_log where created_at > now() - interval '7 days' group by kind) k), '{}'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_segment_overview(seg text, admins text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b2b_users as (select distinct user_id from public.immo_b2b_members),
  u as (
    select au.* from auth.users au
    where lower(coalesce(au.email, '')) <> all (select lower(x) from unnest(admins) x)
      and case when seg = 'b2b' then au.id in (select user_id from b2b_users) else au.id not in (select user_id from b2b_users) end
  ),
  ids as (select id from u),
  m0 as (select date_trunc('month', now()) s)
  select jsonb_build_object(
    'seg', seg,
    'accounts', (select count(*) from u),
    'confirmed', (select count(*) from u where email_confirmed_at is not null),
    'mfa', (select count(distinct f.user_id) from auth.mfa_factors f where f.status = 'verified' and f.user_id in (select id from ids)),
    'banned', (select count(*) from u where banned_until > now()),
    'new7d', (select count(*) from u where created_at > now() - interval '7 days'),
    'new30d', (select count(*) from u where created_at > now() - interval '30 days'),
    'active7d', (select count(*) from u where last_sign_in_at > now() - interval '7 days'),
    'sessions', (select count(*) from auth.sessions s where s.user_id in (select id from ids) and (s.not_after is null or s.not_after > now()) and s.updated_at > now() - interval '30 days'),
    'kreditmappen30d', (select count(*) from public.immo_kreditmappe_versions k where k.owner_id in (select id from ids) and k.created_at > now() - interval '30 days'),
    'documents', (select count(*) from public.immo_documents d where d.owner_id in (select id from ids)),
    'b2c', case when seg = 'b2c' then jsonb_build_object(
      'paying', (select count(*) from public.immo_entitlements e where e.user_id in (select id from ids) and e.status in ('active', 'trialing') and (e.valid_until is null or e.valid_until > now())),
      'objects', (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(ud.objects) = 'array' then ud.objects else '[]'::jsonb end)), 0) from public.immo_user_data ud where ud.user_id in (select id from ids)),
      'purchases30d', (select count(*) from public.immo_kaeufe k where k.created_at > now() - interval '30 days' and k.erstattet_at is null),
      'purchasesCents30d', (select coalesce(sum(k.betrag), 0) from public.immo_kaeufe k where k.created_at > now() - interval '30 days' and k.erstattet_at is null),
      'revenueMonthCents', (select coalesce(sum(i.gross_cents), 0) from public.immo_invoices i, m0 where i.account_id is null and i.issue_date >= m0.s and i.payment_status = 'PAID'),
      'openInvoices', (select count(*) from public.immo_invoices i where i.account_id is null and i.payment_status in ('PENDING', 'OVERDUE'))
    ) else null end,
    'b2b', case when seg = 'b2b' then jsonb_build_object(
      'companies', (select count(*) from public.immo_b2b_accounts),
      'verified', (select count(*) from public.immo_b2b_accounts where verified_at is not null),
      'reviewPending', (select count(*) from public.immo_b2b_accounts where verification_status = 'eingereicht'),
      'locked', (select count(*) from public.immo_b2b_accounts where status is not null and status not in ('active', 'aktiv')),
      'paidPlans', (select count(*) from public.immo_b2b_accounts where plan_tier is not null and plan_tier <> 'FREE' and (plan_until is null or plan_until > now())),
      'leads30d', (select count(*) from public.immo_b2b_leads where created_at > now() - interval '30 days'),
      'leadsNew', (select count(*) from public.immo_b2b_leads where status = 'neu'),
      'submissions30d', (select count(*) from public.immo_b2b_submissions where created_at > now() - interval '30 days'),
      'contactOpen', (select count(*) from public.immo_b2b_contact where status = 'offen'),
      'revenueMonthCents', (select coalesce(sum(i.gross_cents), 0) from public.immo_invoices i, m0 where i.account_id is not null and i.issue_date >= m0.s and i.payment_status = 'PAID'),
      'openInvoices', (select count(*) from public.immo_invoices i where i.account_id is not null and i.payment_status in ('PENDING', 'OVERDUE')),
      'openCents', (select coalesce(sum(i.gross_cents), 0) from public.immo_invoices i where i.account_id is not null and i.payment_status in ('PENDING', 'OVERDUE'))
    ) else null end
  );
$function$
;

CREATE OR REPLACE FUNCTION public.b2b_usage_take(acc uuid, mon text, k text, lim integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur integer;
begin
  insert into public.immo_b2b_usage(account_id, month, kind, n) values (acc, mon, k, 0) on conflict do nothing;
  select n into cur from public.immo_b2b_usage where account_id = acc and month = mon and kind = k for update;
  if lim is not null and cur >= lim then return -1; end if;
  update public.immo_b2b_usage set n = n + 1, updated_at = now() where account_id = acc and month = mon and kind = k;
  return cur + 1;
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_abo_setzen(p_email text, p_customer text, p_subscription text, p_status text, p_plan text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into immo_zugang (email, stripe_customer_id, stripe_subscription_id, pro_status, pro_plan, pro_geprueft_at)
  values (lower(p_email), p_customer, p_subscription, p_status, p_plan, now())
  on conflict (email) do update set
    stripe_subscription_id = case when immo_zugang.stripe_subscription_id is null
        or immo_zugang.stripe_subscription_id = excluded.stripe_subscription_id
        or coalesce(immo_zugang.pro_status, '') not in ('active','trialing','past_due')
      then excluded.stripe_subscription_id else immo_zugang.stripe_subscription_id end,
    pro_status = case when immo_zugang.stripe_subscription_id is null
        or immo_zugang.stripe_subscription_id = excluded.stripe_subscription_id
        or coalesce(immo_zugang.pro_status, '') not in ('active','trialing','past_due')
      then excluded.pro_status else immo_zugang.pro_status end,
    pro_plan = coalesce(excluded.pro_plan, immo_zugang.pro_plan),
    pro_geprueft_at = now(),
    stripe_customer_id = coalesce(immo_zugang.stripe_customer_id, excluded.stripe_customer_id),
    updated_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_consume_share(p_token_hash text)
 RETURNS TABLE(id uuid, owner_id uuid, object_ref text, permissions jsonb, expires_at timestamp with time zone, view_count integer, max_views integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  update public.immo_data_room_shares s
     set view_count = s.view_count + 1
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     and (s.max_views is null or s.view_count < s.max_views)
  returning s.id, s.owner_id, s.object_ref, s.permissions, s.expires_at, s.view_count, s.max_views;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.immo_create_invoice(p jsonb)
 RETURNS immo_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  n bigint;
  ym text := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM');
  num text;
  r public.immo_invoices;
begin
  if coalesce(p->>'invoice_number','') <> '' then
    num := p->>'invoice_number';
  else
    insert into public.immo_counters(name, value) values ('invoice', 1)
      on conflict (name) do update set value = public.immo_counters.value + 1
      returning value into n;
    num := 'RE-' || ym || '-' || lpad(n::text, 5, '0');
  end if;
  insert into public.immo_invoices (invoice_number, kind, refers_to, source, account_id, buyer, items, net_cents, vat_rate, vat_cents, gross_cents,
    payment_method, payment_status, service_period, due_date, paid_at, stripe_invoice_id, stripe_pdf_url, created_by)
  values (num, p->>'kind', nullif(p->>'refers_to','')::uuid, p->>'source', nullif(p->>'account_id','')::uuid, p->'buyer', p->'items',
    (p->>'net_cents')::bigint, coalesce((p->>'vat_rate')::numeric, 19), (p->>'vat_cents')::bigint, (p->>'gross_cents')::bigint,
    p->>'payment_method', coalesce(p->>'payment_status','PENDING'), p->>'service_period', nullif(p->>'due_date','')::date,
    nullif(p->>'paid_at','')::timestamptz, nullif(p->>'stripe_invoice_id',''), nullif(p->>'stripe_pdf_url',''), p->>'created_by')
  returning * into r;
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_erstattung(p_payment_intent text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text; v_guthaben integer; v_rest integer;
begin
  update immo_kaeufe set erstattet_at = now()
   where payment_intent = p_payment_intent and erstattet_at is null and guthaben > 0
  returning email, guthaben into v_email, v_guthaben;
  if v_email is null then return; end if;
  update immo_zugang set objekt_guthaben = greatest(objekt_guthaben - v_guthaben, 0), updated_at = now()
   where email = v_email returning objekt_guthaben into v_rest;
  update immo_freischaltungen f set aufgehoben_at = now()
   where f.email = v_email and f.aufgehoben_at is null and f.record_id in (
     select record_id from immo_freischaltungen where email = v_email and aufgehoben_at is null
      order by created_at asc, record_id asc offset coalesce(v_rest, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_freischalten(p_email text, p_record uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := lower(p_email); v_guthaben integer; v_benutzt integer;
begin
  if exists (select 1 from immo_freischaltungen where email = v_email and record_id = p_record and aufgehoben_at is null) then return 'frei'; end if;
  select objekt_guthaben into v_guthaben from immo_zugang where email = v_email for update;
  select count(*) into v_benutzt from immo_freischaltungen where email = v_email and aufgehoben_at is null;
  if coalesce(v_guthaben, 0) - v_benutzt < 1 then return 'leer'; end if;
  insert into immo_freischaltungen (email, record_id) values (v_email, p_record)
  on conflict (email, record_id) do update set aufgehoben_at = null, created_at = now();
  return 'neu';
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_invoices_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Rechnungen dürfen nicht gelöscht werden (§ 147 AO).';
  end if;
  if new.invoice_number is distinct from old.invoice_number or new.kind is distinct from old.kind
     or new.refers_to is distinct from old.refers_to or new.source is distinct from old.source
     or new.buyer is distinct from old.buyer or new.items is distinct from old.items
     or new.net_cents is distinct from old.net_cents or new.vat_rate is distinct from old.vat_rate
     or new.vat_cents is distinct from old.vat_cents or new.gross_cents is distinct from old.gross_cents
     or new.payment_method is distinct from old.payment_method or new.issue_date is distinct from old.issue_date
     or new.service_period is distinct from old.service_period or new.due_date is distinct from old.due_date
     or new.stripe_invoice_id is distinct from old.stripe_invoice_id or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Rechnungsinhalte sind unveränderbar. Bitte Storno ausstellen.';
  end if;
  if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
    raise exception 'Abgelegtes Rechnungs-PDF ist unveränderbar.';
  end if;
  if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'Prüfsumme ist unveränderbar.';
  end if;
  if old.stripe_pdf_url is not null and new.stripe_pdf_url is distinct from old.stripe_pdf_url then
    raise exception 'Rechnungslink ist unveränderbar.';
  end if;
  if new.account_id is distinct from old.account_id and new.account_id is not null then
    raise exception 'Kontozuordnung kann nur gelöst werden.';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_invoices_no_truncate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'Rechnungen dürfen nicht gelöscht werden (§ 147 AO).'; end $function$
;

CREATE OR REPLACE FUNCTION public.immo_kauf_buchen(p_session text, p_email text, p_plan text, p_betrag integer, p_waehrung text, p_customer text, p_guthaben integer, p_payment_intent text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_neu boolean; v_email text := lower(p_email);
begin
  insert into immo_kaeufe (checkout_session_id, email, plan, betrag, waehrung, guthaben, payment_intent)
  values (p_session, v_email, p_plan, p_betrag, p_waehrung, coalesce(p_guthaben, 0), p_payment_intent)
  on conflict (checkout_session_id) do nothing;
  v_neu := found;
  insert into immo_zugang (email, stripe_customer_id, objekt_guthaben)
  values (v_email, p_customer, case when v_neu then coalesce(p_guthaben, 0) else 0 end)
  on conflict (email) do update set
    objekt_guthaben = immo_zugang.objekt_guthaben + case when v_neu then coalesce(p_guthaben, 0) else 0 end,
    stripe_customer_id = coalesce(immo_zugang.stripe_customer_id, excluded.stripe_customer_id),
    updated_at = now();
  return v_neu;
end $function$
;

CREATE OR REPLACE FUNCTION public.immo_log_client_error(fp text, msg text, src text, pg text, ar text, br text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.immo_client_errors (fingerprint, message, source, page, area, browser)
  values (fp, left(msg, 300), left(src, 200), left(pg, 120), left(ar, 20), left(br, 40))
  on conflict (fingerprint) do update set count = public.immo_client_errors.count + 1, last_seen = now(), resolved_at = null,
    page = excluded.page, browser = excluded.browser;
$function$
;

CREATE OR REPLACE FUNCTION public.immo_mfa_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$function$
;

CREATE OR REPLACE FUNCTION public.immo_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin new.updated_at=now(); return new; end; $function$
;

CREATE OR REPLACE FUNCTION public.immo_user_data_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.next_bank_pdf_version(p_package_id uuid, p_sha256_hex text, p_storage_path text, p_byte_size bigint, p_storage_bucket text DEFAULT 'bank-ready-pdf'::text)
 RETURNS immo_bank_pdf_versions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare v_owner uuid; v_no integer; v_row public.immo_bank_pdf_versions; begin if p_sha256_hex !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if; if p_byte_size <= 0 then raise exception 'invalid_byte_size'; end if; select owner_id into v_owner from public.immo_bank_packages where id=p_package_id; if v_owner is null or v_owner <> auth.uid() then raise exception 'package_not_owned'; end if; if exists(select 1 from public.immo_bank_pdf_versions where package_id=p_package_id and sha256_hex=p_sha256_hex) then raise exception 'duplicate_pdf_hash'; end if; if exists(select 1 from public.immo_bank_pdf_versions where storage_bucket=p_storage_bucket and storage_path=p_storage_path) then raise exception 'duplicate_storage_path'; end if; select coalesce(max(version_no),0)+1 into v_no from public.immo_bank_pdf_versions where package_id=p_package_id; insert into public.immo_bank_pdf_versions(package_id,version_no,sha256_hex,storage_path,storage_bucket,mime_type,byte_size) values(p_package_id,v_no,p_sha256_hex,p_storage_path,p_storage_bucket,'application/pdf',p_byte_size) returning * into v_row; insert into public.immo_bank_pdf_audit(pdf_version_id,package_id,event_type,actor_id,metadata) values(v_row.id,v_row.package_id,'generated',auth.uid(),jsonb_build_object('sha256_hex',v_row.sha256_hex,'byte_size',v_row.byte_size,'storage_bucket',v_row.storage_bucket,'storage_path',v_row.storage_path)); return v_row; end; $function$
;

CREATE OR REPLACE FUNCTION public.revoke_bank_share(p_share_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare v_package uuid; begin select package_id into v_package from public.immo_bank_share_links l join public.immo_bank_packages p on p.id=l.package_id where l.id=p_share_id and p.owner_id=auth.uid(); if v_package is null then raise exception 'share_not_owned'; end if; update public.immo_bank_share_links set revoked_at=now() where id=p_share_id and revoked_at is null; if not found then return false; end if; insert into public.immo_bank_share_events(share_link_id,package_id,event_type,actor_id) select id,package_id,'revoked',auth.uid() from public.immo_bank_share_links where id=p_share_id; return true; end; $function$
;

CREATE OR REPLACE FUNCTION public.set_immo_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  new.last_saved_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$function$
;

-- ===================== Triggers =====================
CREATE TRIGGER trg_immo_ingestion_updated_at BEFORE UPDATE ON public.immo_document_ingestion_jobs FOR EACH ROW EXECUTE FUNCTION immo_touch_updated_at();
CREATE TRIGGER immo_invoices_guard_upd BEFORE DELETE OR UPDATE ON public.immo_invoices FOR EACH ROW EXECUTE FUNCTION immo_invoices_guard();
CREATE TRIGGER immo_invoices_guard_trunc BEFORE TRUNCATE ON public.immo_invoices FOR EACH STATEMENT EXECUTE FUNCTION immo_invoices_no_truncate();
CREATE TRIGGER immo_user_data_updated_at BEFORE UPDATE ON public.immo_user_data FOR EACH ROW EXECUTE FUNCTION immo_user_data_set_updated_at();
CREATE TRIGGER trg_immo_user_data_updated BEFORE UPDATE ON public.immo_user_data FOR EACH ROW EXECUTE FUNCTION set_immo_updated_at();

-- ===================== Row level security =====================
alter table public.evidence_refs enable row level security;
alter table public.immo_access_audit enable row level security;
alter table public.immo_admin_audit enable row level security;
alter table public.immo_analytics enable row level security;
alter table public.immo_audit_log enable row level security;
alter table public.immo_b2b_accounts enable row level security;
alter table public.immo_b2b_clients enable row level security;
alter table public.immo_b2b_contact enable row level security;
alter table public.immo_b2b_invites enable row level security;
alter table public.immo_b2b_leads enable row level security;
alter table public.immo_b2b_members enable row level security;
alter table public.immo_b2b_partner_codes enable row level security;
alter table public.immo_b2b_submissions enable row level security;
alter table public.immo_b2b_usage enable row level security;
alter table public.immo_b2b_verification_docs enable row level security;
alter table public.immo_bank_package_sections enable row level security;
alter table public.immo_bank_packages enable row level security;
alter table public.immo_bank_pdf_audit enable row level security;
alter table public.immo_bank_pdf_versions enable row level security;
alter table public.immo_bank_ready_scores enable row level security;
alter table public.immo_bank_share_events enable row level security;
alter table public.immo_bank_share_links enable row level security;
alter table public.immo_campaigns enable row level security;
alter table public.immo_client_errors enable row level security;
alter table public.immo_counters enable row level security;
alter table public.immo_crm_activities enable row level security;
alter table public.immo_crm_contacts enable row level security;
alter table public.immo_data_room_access_log enable row level security;
alter table public.immo_data_room_shares enable row level security;
alter table public.immo_deals enable row level security;
alter table public.immo_decision_scenarios enable row level security;
alter table public.immo_document_events enable row level security;
alter table public.immo_document_ingestion_jobs enable row level security;
alter table public.immo_document_requests enable row level security;
alter table public.immo_documents enable row level security;
alter table public.immo_entitlements enable row level security;
alter table public.immo_evidence enable row level security;
alter table public.immo_freischaltungen enable row level security;
alter table public.immo_invites enable row level security;
alter table public.immo_invoices enable row level security;
alter table public.immo_kaeufe enable row level security;
alter table public.immo_kreditmappe_credits enable row level security;
alter table public.immo_kreditmappe_versions enable row level security;
alter table public.immo_newsletter enable row level security;
alter table public.immo_newsletter_deliveries enable row level security;
alter table public.immo_newsletter_sends enable row level security;
alter table public.immo_partners enable row level security;
alter table public.immo_records enable row level security;
alter table public.immo_reminder_log enable row level security;
alter table public.immo_security_blocks enable row level security;
alter table public.immo_security_log enable row level security;
alter table public.immo_sessions enable row level security;
alter table public.immo_settings enable row level security;
alter table public.immo_stress_scenarios enable row level security;
alter table public.immo_suppression enable row level security;
alter table public.immo_underwriting_cases enable row level security;
alter table public.immo_user_data enable row level security;
alter table public.immo_users enable row level security;
alter table public.immo_verify_views enable row level security;
alter table public.immo_veto_events enable row level security;
alter table public.immo_veto_findings enable row level security;
alter table public.immo_webhook_log enable row level security;
alter table public.immo_zugang enable row level security;
alter table public.properties enable row level security;
alter table public.property_documents enable row level security;
alter table public.rt_admin_sessions enable row level security;
alter table public.rt_admins enable row level security;
alter table public.rt_config enable row level security;
alter table public.rt_login_attempts enable row level security;

-- ===================== Policies =====================
create policy authenticated_evidence_insert on public.evidence_refs as PERMISSIVE for INSERT to authenticated with check (true);
create policy authenticated_evidence_select on public.evidence_refs as PERMISSIVE for SELECT to authenticated using (true);
create policy audit_owner_read on public.immo_access_audit as PERMISSIVE for SELECT to public using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_audit_auth_insert on public.immo_audit_log as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_audit_auth_select on public.immo_audit_log as PERMISSIVE for SELECT to authenticated using (true);
create policy bank_sections_owner_delete on public.immo_bank_package_sections as PERMISSIVE for DELETE to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_package_sections.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_sections_owner_insert on public.immo_bank_package_sections as PERMISSIVE for INSERT to authenticated with check ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_package_sections.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_sections_owner_select on public.immo_bank_package_sections as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_package_sections.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_sections_owner_update on public.immo_bank_package_sections as PERMISSIVE for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_package_sections.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_package_sections.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_packages_owner_insert on public.immo_bank_packages as PERMISSIVE for INSERT to authenticated with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy bank_packages_owner_select on public.immo_bank_packages as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy bank_packages_owner_update on public.immo_bank_packages as PERMISSIVE for UPDATE to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy bank_pdf_audit_owner_select on public.immo_bank_pdf_audit as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_pdf_audit.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_pdf_versions_owner_select on public.immo_bank_pdf_versions as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_pdf_versions.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy immo_bank_score_auth_insert on public.immo_bank_ready_scores as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_bank_score_auth_select on public.immo_bank_ready_scores as PERMISSIVE for SELECT to authenticated using (true);
create policy bank_share_events_owner_select on public.immo_bank_share_events as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_share_events.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy bank_share_links_owner_select on public.immo_bank_share_links as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM immo_bank_packages p
  WHERE ((p.id = immo_bank_share_links.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy room_access_owner_select on public.immo_data_room_access_log as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_share_owner_insert_v2 on public.immo_data_room_shares as PERMISSIVE for INSERT to authenticated with check ((created_by = ( SELECT auth.uid() AS uid)));
create policy immo_share_owner_select_v2 on public.immo_data_room_shares as PERMISSIVE for SELECT to authenticated using ((created_by = ( SELECT auth.uid() AS uid)));
create policy immo_share_owner_update_v2 on public.immo_data_room_shares as PERMISSIVE for UPDATE to authenticated using ((created_by = ( SELECT auth.uid() AS uid))) with check ((created_by = ( SELECT auth.uid() AS uid)));
create policy immo_shares_mfa on public.immo_data_room_shares as RESTRICTIVE for ALL to authenticated using (immo_mfa_ok()) with check (immo_mfa_ok());
create policy deals_owner_all on public.immo_deals as PERMISSIVE for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_decision_auth_insert on public.immo_decision_scenarios as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_decision_auth_select on public.immo_decision_scenarios as PERMISSIVE for SELECT to authenticated using (true);
create policy immo_document_events_insert on public.immo_document_events as PERMISSIVE for INSERT to authenticated with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_document_events_select on public.immo_document_events as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_ingestion_owner_insert on public.immo_document_ingestion_jobs as PERMISSIVE for INSERT to authenticated with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_ingestion_owner_select on public.immo_document_ingestion_jobs as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_ingestion_owner_update on public.immo_document_ingestion_jobs as PERMISSIVE for UPDATE to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy doc_requests_owner_select on public.immo_document_requests as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy documents_no_client_insert on public.immo_documents as RESTRICTIVE for INSERT to authenticated with check (false);
create policy documents_no_client_update on public.immo_documents as RESTRICTIVE for UPDATE to authenticated using (false) with check (false);
create policy documents_owner_all on public.immo_documents as PERMISSIVE for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_documents_mfa on public.immo_documents as RESTRICTIVE for ALL to authenticated using (immo_mfa_ok()) with check (immo_mfa_ok());
create policy immo_entitlements_select_own on public.immo_entitlements as PERMISSIVE for SELECT to public using ((( SELECT auth.uid() AS uid) = user_id));
create policy evidence_owner_all on public.immo_evidence as PERMISSIVE for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM immo_deals d
  WHERE ((d.id = immo_evidence.deal_id) AND (d.owner_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM immo_deals d
  WHERE ((d.id = immo_evidence.deal_id) AND (d.owner_id = ( SELECT auth.uid() AS uid))))));
create policy km_credits_owner_select on public.immo_kreditmappe_credits as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_km_versions_mfa on public.immo_kreditmappe_versions as RESTRICTIVE for SELECT to authenticated using (immo_mfa_ok());
create policy km_versions_owner_select on public.immo_kreditmappe_versions as PERMISSIVE for SELECT to authenticated using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy immo_reminder_log_select_own on public.immo_reminder_log as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = owner_id));
create policy immo_stress_auth_insert on public.immo_stress_scenarios as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_stress_auth_select on public.immo_stress_scenarios as PERMISSIVE for SELECT to authenticated using (true);
create policy immo_underwriting_auth_insert on public.immo_underwriting_cases as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_underwriting_auth_select on public.immo_underwriting_cases as PERMISSIVE for SELECT to authenticated using (true);
create policy immo_underwriting_auth_update on public.immo_underwriting_cases as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy immo_user_data_insert_own on public.immo_user_data as PERMISSIVE for INSERT to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));
create policy immo_user_data_mfa on public.immo_user_data as RESTRICTIVE for ALL to authenticated using (immo_mfa_ok()) with check (immo_mfa_ok());
create policy immo_user_data_select_own on public.immo_user_data as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy immo_user_data_update_own on public.immo_user_data as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy veto_owner_all on public.immo_veto_events as PERMISSIVE for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM immo_deals d
  WHERE ((d.id = immo_veto_events.deal_id) AND (d.owner_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM immo_deals d
  WHERE ((d.id = immo_veto_events.deal_id) AND (d.owner_id = ( SELECT auth.uid() AS uid))))));
create policy immo_veto_auth_insert on public.immo_veto_findings as PERMISSIVE for INSERT to authenticated with check (true);
create policy immo_veto_auth_select on public.immo_veto_findings as PERMISSIVE for SELECT to authenticated using (true);
create policy authenticated_properties_insert on public.properties as PERMISSIVE for INSERT to authenticated with check (true);
create policy authenticated_properties_select on public.properties as PERMISSIVE for SELECT to authenticated using (true);
create policy authenticated_properties_update on public.properties as PERMISSIVE for UPDATE to authenticated using (true) with check (true);
create policy authenticated_documents_insert on public.property_documents as PERMISSIVE for INSERT to authenticated with check (true);
create policy authenticated_documents_select on public.property_documents as PERMISSIVE for SELECT to authenticated using (true);
create policy bank_ready_pdf_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'bank-ready-pdf'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.jwt() ->> 'sub'::text)))));
create policy bank_ready_pdf_select on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bank-ready-pdf'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.jwt() ->> 'sub'::text)))));
create policy immo_private_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy immo_private_no_client_insert on storage.objects as RESTRICTIVE for INSERT to authenticated with check ((bucket_id <> 'immo-private'::text));
create policy immo_private_no_client_update on storage.objects as RESTRICTIVE for UPDATE to authenticated using ((bucket_id <> 'immo-private'::text)) with check ((bucket_id <> 'immo-private'::text));
create policy immo_private_read on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy immo_private_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) with check (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy immo_private_upload on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

-- ===================== Grants (anon/authenticated) =====================
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.evidence_refs to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_access_audit to anon;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_admin_audit to anon;
grant TRIGGER, INSERT, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_audit_log to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_b2b_accounts to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_b2b_contact to anon;
grant REFERENCES, TRIGGER, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_b2b_invites to anon;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_b2b_leads to anon;
grant REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER on public.immo_b2b_members to anon;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_b2b_partner_codes to anon;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_b2b_submissions to anon;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_b2b_verification_docs to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_bank_package_sections to anon;
grant TRIGGER, INSERT, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_bank_packages to anon;
grant TRUNCATE, TRIGGER, REFERENCES, DELETE, UPDATE, SELECT, INSERT on public.immo_bank_pdf_audit to anon;
grant SELECT, UPDATE, DELETE, INSERT, TRUNCATE, REFERENCES, TRIGGER on public.immo_bank_pdf_versions to anon;
grant UPDATE, INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, SELECT on public.immo_bank_ready_scores to anon;
grant TRUNCATE, TRIGGER, REFERENCES, DELETE, UPDATE, SELECT, INSERT on public.immo_bank_share_events to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_bank_share_links to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_counters to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_data_room_access_log to anon;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_data_room_shares to anon;
grant UPDATE, TRIGGER, REFERENCES, INSERT, TRUNCATE, DELETE, SELECT on public.immo_deals to anon;
grant DELETE, INSERT, SELECT, UPDATE, TRUNCATE, REFERENCES, TRIGGER on public.immo_decision_scenarios to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_document_events to anon;
grant INSERT, REFERENCES, UPDATE, DELETE, TRUNCATE, TRIGGER, SELECT on public.immo_document_ingestion_jobs to anon;
grant TRIGGER, REFERENCES, SELECT, TRUNCATE on public.immo_document_requests to anon;
grant DELETE, INSERT, SELECT, UPDATE, TRUNCATE, REFERENCES, TRIGGER on public.immo_documents to anon;
grant REFERENCES, TRUNCATE, TRIGGER, INSERT, SELECT, UPDATE, DELETE on public.immo_entitlements to anon;
grant TRUNCATE, UPDATE, DELETE, TRIGGER, REFERENCES, SELECT, INSERT on public.immo_evidence to anon;
grant TRUNCATE, DELETE, UPDATE, SELECT, REFERENCES, INSERT, TRIGGER on public.immo_freischaltungen to anon;
grant UPDATE, SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_invites to anon;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_invoices to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT, SELECT on public.immo_kaeufe to anon;
grant TRUNCATE, REFERENCES, TRIGGER, SELECT on public.immo_kreditmappe_credits to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_kreditmappe_versions to anon;
grant TRIGGER, SELECT, DELETE, UPDATE, TRUNCATE, REFERENCES, INSERT on public.immo_records to anon;
grant REFERENCES, SELECT, UPDATE, DELETE, TRIGGER, INSERT, TRUNCATE on public.immo_reminder_log to anon;
grant INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT on public.immo_security_log to anon;
grant UPDATE, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT on public.immo_sessions to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_settings to anon;
grant SELECT, INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE on public.immo_stress_scenarios to anon;
grant REFERENCES, TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE on public.immo_suppression to anon;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_underwriting_cases to anon;
grant TRUNCATE, TRIGGER, REFERENCES, DELETE, UPDATE, SELECT, INSERT on public.immo_users to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_verify_views to anon;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_veto_events to anon;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_veto_findings to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT, SELECT on public.immo_webhook_log to anon;
grant TRUNCATE, DELETE, UPDATE, SELECT, INSERT, TRIGGER, REFERENCES on public.immo_zugang to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.properties to anon;
grant REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER on public.property_documents to anon;
grant REFERENCES, INSERT, TRIGGER, SELECT, UPDATE, DELETE, TRUNCATE on public.rt_admin_sessions to anon;
grant UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT, SELECT on public.rt_admins to anon;
grant DELETE, SELECT, INSERT, TRIGGER, TRUNCATE, UPDATE, REFERENCES on public.rt_config to anon;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, SELECT, UPDATE, DELETE on public.rt_login_attempts to anon;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.evidence_refs to authenticated;
grant TRIGGER, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, INSERT on public.immo_access_audit to authenticated;
grant SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.immo_admin_audit to authenticated;
grant REFERENCES, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER, INSERT on public.immo_audit_log to authenticated;
grant SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.immo_b2b_accounts to authenticated;
grant SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, UPDATE on public.immo_b2b_contact to authenticated;
grant REFERENCES, TRIGGER, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_b2b_invites to authenticated;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_b2b_leads to authenticated;
grant REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER on public.immo_b2b_members to authenticated;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_b2b_partner_codes to authenticated;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_b2b_submissions to authenticated;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_b2b_verification_docs to authenticated;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_bank_package_sections to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_bank_packages to authenticated;
grant SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.immo_bank_pdf_audit to authenticated;
grant SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.immo_bank_pdf_versions to authenticated;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_bank_ready_scores to authenticated;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_bank_share_events to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_bank_share_links to authenticated;
grant DELETE, REFERENCES, TRUNCATE, UPDATE, SELECT, INSERT, TRIGGER on public.immo_counters to authenticated;
grant TRIGGER, REFERENCES, TRUNCATE, INSERT, SELECT, DELETE, UPDATE on public.immo_data_room_access_log to authenticated;
grant DELETE, TRIGGER, REFERENCES, TRUNCATE, UPDATE, SELECT, INSERT on public.immo_data_room_shares to authenticated;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT on public.immo_deals to authenticated;
grant INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER on public.immo_decision_scenarios to authenticated;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_document_events to authenticated;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_document_ingestion_jobs to authenticated;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE on public.immo_document_requests to authenticated;
grant TRUNCATE, REFERENCES, TRIGGER, INSERT, SELECT, UPDATE, DELETE on public.immo_documents to authenticated;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_entitlements to authenticated;
grant DELETE, UPDATE, SELECT, INSERT, TRIGGER, REFERENCES, TRUNCATE on public.immo_evidence to authenticated;
grant TRUNCATE, REFERENCES, TRIGGER, INSERT, SELECT, UPDATE, DELETE on public.immo_freischaltungen to authenticated;
grant REFERENCES, TRUNCATE, DELETE, INSERT, UPDATE, SELECT, TRIGGER on public.immo_invites to authenticated;
grant DELETE, UPDATE, SELECT, INSERT, TRIGGER, REFERENCES, TRUNCATE on public.immo_invoices to authenticated;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, SELECT, UPDATE on public.immo_kaeufe to authenticated;
grant SELECT, TRIGGER, TRUNCATE, REFERENCES on public.immo_kreditmappe_credits to authenticated;
grant INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_kreditmappe_versions to authenticated;
grant DELETE, SELECT, UPDATE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.immo_records to authenticated;
grant REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER on public.immo_reminder_log to authenticated;
grant TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES on public.immo_security_log to authenticated;
grant TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT, SELECT on public.immo_sessions to authenticated;
grant SELECT, UPDATE, INSERT, DELETE, TRIGGER, TRUNCATE, REFERENCES on public.immo_settings to authenticated;
grant TRIGGER, INSERT, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_stress_scenarios to authenticated;
grant REFERENCES, UPDATE, DELETE, TRUNCATE, TRIGGER, INSERT, SELECT on public.immo_suppression to authenticated;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_underwriting_cases to authenticated;
grant SELECT, INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE on public.immo_user_data to authenticated;
grant DELETE, TRIGGER, REFERENCES, UPDATE, SELECT, INSERT, TRUNCATE on public.immo_users to authenticated;
grant INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, UPDATE, SELECT on public.immo_verify_views to authenticated;
grant REFERENCES, INSERT, TRIGGER, TRUNCATE, DELETE, UPDATE, SELECT on public.immo_veto_events to authenticated;
grant INSERT, DELETE, TRUNCATE, REFERENCES, SELECT, UPDATE, TRIGGER on public.immo_veto_findings to authenticated;
grant SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, INSERT on public.immo_webhook_log to authenticated;
grant INSERT, TRUNCATE, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER on public.immo_zugang to authenticated;
grant UPDATE, TRIGGER, REFERENCES, TRUNCATE, DELETE, SELECT, INSERT on public.properties to authenticated;
grant SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT on public.property_documents to authenticated;
grant REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, TRIGGER, INSERT on public.rt_admin_sessions to authenticated;
grant INSERT, TRIGGER, REFERENCES, UPDATE, TRUNCATE, DELETE, SELECT on public.rt_admins to authenticated;
grant TRIGGER, DELETE, REFERENCES, SELECT, UPDATE, INSERT, TRUNCATE on public.rt_config to authenticated;
grant SELECT, INSERT, UPDATE, DELETE, TRIGGER, REFERENCES, TRUNCATE on public.rt_login_attempts to authenticated;

-- ===================== Comments =====================
comment on table public.immo_b2b_clients is 'Kunde verbindet sich mit einem Unternehmenskonto (Einwilligung); Berater sieht nur Fortschrittszahlen, keine Inhalte.';
comment on table public.immo_suppression is 'Globale Werbe-Sperrliste (§ 7 UWG, Art. 21 DSGVO): nur Hashes, kein Klartext. Einträge blockieren jede künftige werbliche Ansprache.';

-- ===================== Storage buckets =====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('bank-ready-pdf', 'bank-ready-pdf', f, 52428800, '{application/pdf}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('immo-invoices', 'immo-invoices', f, 5242880, '{application/pdf}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('b2b-logos', 'b2b-logos', f, 1048576, '{image/png,image/jpeg}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('immo-private', 'immo-private', f, 52428800, '{application/pdf,image/jpeg,image/png,image/webp,image/tiff}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('immo-exports', 'immo-exports', f, 209715200, '{application/zip,application/pdf}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('b2b-verify', 'b2b-verify', f, 10485760, '{application/pdf,image/jpeg,image/png}') on conflict (id) do nothing;
