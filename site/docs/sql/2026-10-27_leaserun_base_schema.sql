-- LeaseRun base schema (2026-10-27)
-- Rebuilt from the ImmoAdv production catalogs (schema public) for the ported ImmoAdv code.
-- Renamed: immo_ -> lr_, immoadv -> leaserun, ImmoAdv -> LeaseRun. German comments and messages translated to English.
-- Not included: immo_tax_* (tax/eBay/Amazon), rt_* (other app), schema archiv, public.properties,
--   public.property_documents, public.evidence_refs, tables marked "currently unused", pg_cron jobs.
-- Additive and idempotent: IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks. Nothing is dropped.
-- Applied as migrations leaserun_base_1a_tables … leaserun_base_6_seeds.

-- ===================== 1a.sql =====================
CREATE SEQUENCE IF NOT EXISTS public.lr_admin_audit_id_seq AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.lr_b2b_customer_seq AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.lr_security_log_id_seq AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.lr_verify_views_id_seq AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.lr_webhook_log_id_seq AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1;

CREATE TABLE IF NOT EXISTS public.api_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tenant_id uuid,
  environment text,
  actor text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  request_id text,
  result text DEFAULT 'success'::text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  prev_hash text,
  hash text DEFAULT ''::text NOT NULL,
  CONSTRAINT api_audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT api_audit_events_result_check CHECK ((result = ANY (ARRAY['success'::text, 'failure'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_cases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  external_reference text,
  status text DEFAULT 'open'::text NOT NULL,
  data jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_key uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT api_cases_pkey PRIMARY KEY (id),
  CONSTRAINT api_cases_data_check CHECK ((jsonb_typeof(data) = 'object'::text)),
  CONSTRAINT api_cases_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_cases_external_reference_check CHECK (((external_reference IS NULL) OR (char_length(external_reference) <= 120))),
  CONSTRAINT api_cases_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
  CONSTRAINT api_cases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'action_required'::text, 'completed'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  case_id uuid NOT NULL,
  type text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  sha256 text NOT NULL,
  status text DEFAULT 'uploaded'::text NOT NULL,
  classification text,
  verification_status text DEFAULT 'pending'::text NOT NULL,
  malware_scan text DEFAULT 'not_configured'::text NOT NULL,
  storage_path text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT api_documents_pkey PRIMARY KEY (id),
  CONSTRAINT api_documents_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_documents_filename_check CHECK (((char_length(filename) >= 1) AND (char_length(filename) <= 200))),
  CONSTRAINT api_documents_malware_scan_check CHECK ((malware_scan = ANY (ARRAY['not_configured'::text, 'clean'::text, 'infected'::text, 'error'::text]))),
  CONSTRAINT api_documents_mime_type_check CHECK ((mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/tiff'::text]))),
  CONSTRAINT api_documents_sha256_check CHECK ((char_length(sha256) = 64)),
  CONSTRAINT api_documents_size_check CHECK ((size > 0)),
  CONSTRAINT api_documents_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'classified'::text, 'verified'::text, 'rejected'::text, 'failed'::text]))),
  CONSTRAINT api_documents_verification_status_check CHECK ((verification_status = ANY (ARRAY['pending'::text, 'formally_verified'::text, 'rejected'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  idem_key text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT api_idempotency_keys_pkey PRIMARY KEY (tenant_id, environment, idem_key),
  CONSTRAINT api_idempotency_keys_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_idempotency_keys_idem_key_check CHECK (((char_length(idem_key) >= 8) AND (char_length(idem_key) <= 120)))
);
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] DEFAULT '{}'::text[] NOT NULL,
  allowed_ips text[] DEFAULT '{}'::text[] NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  disabled_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_reason text,
  rotated_from uuid,
  last_used_at timestamp with time zone,
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
  CONSTRAINT api_keys_key_prefix_key UNIQUE (key_prefix),
  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_keys_key_hash_check CHECK ((char_length(key_hash) = 64)),
  CONSTRAINT api_keys_key_prefix_check CHECK ((key_prefix ~ '^(test|live)_[A-Za-z0-9]{8}$'::text)),
  CONSTRAINT api_keys_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
  CONSTRAINT api_keys_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);
CREATE TABLE IF NOT EXISTS public.api_rate_counters (
  bucket text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  n integer DEFAULT 0 NOT NULL,
  CONSTRAINT api_rate_counters_pkey PRIMARY KEY (bucket, window_start)
);
CREATE TABLE IF NOT EXISTS public.api_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  case_id uuid NOT NULL,
  validation_id uuid,
  status text DEFAULT 'queued'::text NOT NULL,
  branding text NOT NULL,
  storage_path text,
  sha256 text,
  size integer,
  error text,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  CONSTRAINT api_reports_pkey PRIMARY KEY (id),
  CONSTRAINT api_reports_branding_check CHECK ((branding = ANY (ARRAY['leaserun'::text, 'white_label'::text]))),
  CONSTRAINT api_reports_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_reports_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  request_id text NOT NULL,
  tenant_id uuid,
  key_id uuid,
  key_prefix text,
  environment text,
  method text NOT NULL,
  route text NOT NULL,
  status integer NOT NULL,
  duration_ms integer NOT NULL,
  response_bytes integer,
  error_code text,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT api_requests_pkey PRIMARY KEY (id),
  CONSTRAINT api_requests_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_tenant_policies (
  tenant_id uuid NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  live_enabled boolean DEFAULT false NOT NULL,
  rate_limit integer,
  burst_limit integer,
  max_document_bytes integer,
  webhooks_allowed boolean,
  white_label_allowed boolean,
  routing_enabled boolean DEFAULT false NOT NULL,
  note text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text,
  CONSTRAINT api_tenant_policies_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT api_tenant_policies_burst_limit_check CHECK (((burst_limit IS NULL) OR ((burst_limit >= 1) AND (burst_limit <= 100000)))),
  CONSTRAINT api_tenant_policies_max_document_bytes_check CHECK (((max_document_bytes IS NULL) OR ((max_document_bytes >= 1024) AND (max_document_bytes <= 4194304)))),
  CONSTRAINT api_tenant_policies_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
  CONSTRAINT api_tenant_policies_rate_limit_check CHECK (((rate_limit IS NULL) OR ((rate_limit >= 1) AND (rate_limit <= 100000))))
);
CREATE TABLE IF NOT EXISTS public.api_validation_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  case_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  completeness_score integer,
  result jsonb,
  engine_version text DEFAULT '1.0'::text NOT NULL,
  duration_ms integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  evaluated_at timestamp with time zone,
  CONSTRAINT api_validation_runs_pkey PRIMARY KEY (id),
  CONSTRAINT api_validation_runs_completeness_score_check CHECK (((completeness_score >= 0) AND (completeness_score <= 100))),
  CONSTRAINT api_validation_runs_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_validation_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_webhook_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  endpoint_id uuid NOT NULL,
  event text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  last_status integer,
  last_error text,
  response_excerpt text,
  duration_ms integer,
  is_test boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  delivered_at timestamp with time zone,
  CONSTRAINT api_webhook_deliveries_endpoint_id_dedupe_key_key UNIQUE (endpoint_id, dedupe_key),
  CONSTRAINT api_webhook_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT api_webhook_deliveries_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'retrying'::text, 'failed'::text])))
);
CREATE TABLE IF NOT EXISTS public.api_webhook_endpoints (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  url text NOT NULL,
  description text,
  secret_enc text NOT NULL,
  secret_prefix text NOT NULL,
  events text[] NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  failure_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_delivery_at timestamp with time zone,
  CONSTRAINT api_webhook_endpoints_pkey PRIMARY KEY (id),
  CONSTRAINT api_webhook_endpoints_description_check CHECK (((description IS NULL) OR (char_length(description) <= 200))),
  CONSTRAINT api_webhook_endpoints_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text]))),
  CONSTRAINT api_webhook_endpoints_events_check CHECK ((cardinality(events) > 0)),
  CONSTRAINT api_webhook_endpoints_url_check CHECK (((url ~ '^https://'::text) AND (char_length(url) <= 500)))
);
CREATE TABLE IF NOT EXISTS public.lr_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id uuid,
  deal_id uuid,
  document_id uuid,
  share_id uuid,
  action text NOT NULL,
  actor text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_access_audit_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_access_grants (
  user_id uuid NOT NULL,
  tier text NOT NULL,
  credit_maps integer DEFAULT 0 NOT NULL,
  leitfaden boolean DEFAULT false NOT NULL,
  valid_until timestamp with time zone,
  note text,
  granted_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  features jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT lr_access_grants_pkey PRIMARY KEY (user_id),
  CONSTRAINT lr_access_grants_credit_maps_check CHECK (((credit_maps >= 0) AND (credit_maps <= 1000))),
  CONSTRAINT lr_access_grants_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
  CONSTRAINT lr_access_grants_tier_check CHECK ((tier = ANY (ARRAY['starter'::text, 'pro'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_admin_audit (
  id bigint DEFAULT nextval('lr_admin_audit_id_seq'::regclass) NOT NULL,
  actor_email text NOT NULL,
  action text NOT NULL,
  target text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_admin_audit_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_admin_push_tokens (
  token text NOT NULL,
  user_id uuid NOT NULL,
  email text NOT NULL,
  platform text DEFAULT 'ios'::text NOT NULL,
  prefs jsonb DEFAULT '{"mail": true, "booking": true, "payment": true, "security": true}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_admin_push_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT lr_admin_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
  CONSTRAINT lr_admin_push_tokens_token_check CHECK ((char_length(token) <= 200))
);
CREATE TABLE IF NOT EXISTS public.lr_admin_roles (
  email text NOT NULL,
  role text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_admin_roles_pkey PRIMARY KEY (email),
  CONSTRAINT lr_admin_roles_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 200))),
  CONSTRAINT lr_admin_roles_role_check CHECK ((role = ANY (ARRAY['support'::text, 'finance'::text, 'viewer'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_analytics (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  ts timestamp with time zone DEFAULT now() NOT NULL,
  seg text NOT NULL,
  ev text NOT NULL,
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
  city text,
  CONSTRAINT lr_analytics_pkey PRIMARY KEY (id),
  CONSTRAINT lr_analytics_browser_check CHECK (((browser IS NULL) OR (char_length(browser) <= 20))),
  CONSTRAINT lr_analytics_camp_check CHECK (((camp IS NULL) OR (char_length(camp) <= 60))),
  CONSTRAINT lr_analytics_city_check CHECK (((city IS NULL) OR (char_length(city) <= 80))),
  CONSTRAINT lr_analytics_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
  CONSTRAINT lr_analytics_device_check CHECK (((device IS NULL) OR (device = ANY (ARRAY['mobile'::text, 'tablet'::text, 'desktop'::text])))),
  CONSTRAINT lr_analytics_ev_check CHECK ((ev ~ '^[a-z_]{2,24}$'::text)),
  CONSTRAINT lr_analytics_med_check CHECK (((med IS NULL) OR (char_length(med) <= 40))),
  CONSTRAINT lr_analytics_os_check CHECK (((os IS NULL) OR (char_length(os) <= 20))),
  CONSTRAINT lr_analytics_path_check CHECK (((path IS NULL) OR (char_length(path) <= 160))),
  CONSTRAINT lr_analytics_plan_check CHECK (((plan IS NULL) OR (char_length(plan) <= 40))),
  CONSTRAINT lr_analytics_ref_check CHECK (((ref IS NULL) OR (char_length(ref) <= 80))),
  CONSTRAINT lr_analytics_region_check CHECK (((region IS NULL) OR (char_length(region) <= 60))),
  CONSTRAINT lr_analytics_seg_check CHECK ((seg = ANY (ARRAY['b2c'::text, 'b2b'::text]))),
  CONSTRAINT lr_analytics_src_check CHECK (((src IS NULL) OR (char_length(src) <= 60))),
  CONSTRAINT lr_analytics_visitor_check CHECK (((visitor IS NULL) OR (visitor ~ '^[0-9a-f]{16}$'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  customer_number text DEFAULT ((('KD-'::text || to_char((now() AT TIME ZONE 'Europe/Berlin'::text), 'YYYY'::text)) || '-'::text) || lpad((nextval('lr_b2b_customer_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  company_name text NOT NULL,
  legal_form text NOT NULL,
  institution_type text NOT NULL,
  register_number text,
  tax_id text,
  advisor_name text NOT NULL,
  email text NOT NULL,
  phone text,
  street text,
  postal_code text NOT NULL,
  city text NOT NULL,
  plan_tier text,
  plan_source text,
  plan_until timestamp with time zone,
  status text DEFAULT 'pending'::text NOT NULL,
  lock_reason text,
  dossier_bonus integer DEFAULT 0 NOT NULL,
  has_whitelabel boolean DEFAULT false NOT NULL,
  allow_invoice_payment boolean DEFAULT false NOT NULL,
  invoice_limit_cents integer,
  payment_terms_days integer DEFAULT 14 NOT NULL,
  unternehmer_confirmed_at timestamp with time zone,
  avv_accepted_at timestamp with time zone,
  avv_version text,
  referral text,
  logo_path text,
  brand_color text,
  booking_url text,
  slug text,
  widget_key text,
  widget_active boolean DEFAULT true NOT NULL,
  allowed_domains text[] DEFAULT '{}'::text[] NOT NULL,
  lead_gate boolean DEFAULT true NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  verified_at timestamp with time zone,
  billing_interval text,
  support_access_until timestamp with time zone,
  accept_submissions boolean DEFAULT false NOT NULL,
  custom_disclaimer text,
  lead_retention_months integer DEFAULT 24 NOT NULL,
  webhook_url text,
  webhook_secret text,
  verification_status text DEFAULT 'offen'::text NOT NULL,
  verification_note text,
  verification_submitted_at timestamp with time zone,
  verification_decided_at timestamp with time zone,
  brand_color2 text,
  brand_font text,
  doc_title text,
  doc_sender text,
  doc_footer text,
  avv_evidence jsonb,
  modules jsonb DEFAULT '{}'::jsonb NOT NULL,
  branche text DEFAULT 'allgemein'::text NOT NULL,
  extra_branches text[] DEFAULT '{}'::text[] NOT NULL,
  CONSTRAINT lr_b2b_accounts_customer_number_key UNIQUE (customer_number),
  CONSTRAINT lr_b2b_accounts_owner_id_key UNIQUE (owner_id),
  CONSTRAINT lr_b2b_accounts_slug_key UNIQUE (slug),
  CONSTRAINT lr_b2b_accounts_widget_key_key UNIQUE (widget_key),
  CONSTRAINT lr_b2b_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_accounts_advisor_name_check CHECK (((char_length(advisor_name) >= 2) AND (char_length(advisor_name) <= 120))),
  CONSTRAINT lr_b2b_accounts_billing_interval_check CHECK (((billing_interval IS NULL) OR (billing_interval = ANY (ARRAY['month'::text, 'year'::text])))),
  CONSTRAINT lr_b2b_accounts_booking_url_check CHECK (((booking_url IS NULL) OR (booking_url ~ '^https://'::text))),
  CONSTRAINT lr_b2b_accounts_branche_check CHECK ((branche = ANY (ARRAY['bank'::text, 'vermittler'::text, 'makler'::text, 'finanzberater'::text, 'allgemein'::text]))),
  CONSTRAINT lr_b2b_accounts_brand_color2_check CHECK (((brand_color2 IS NULL) OR (brand_color2 ~ '^#[0-9A-Fa-f]{6}$'::text))),
  CONSTRAINT lr_b2b_accounts_brand_color_check CHECK (((brand_color IS NULL) OR (brand_color ~ '^#[0-9A-Fa-f]{6}$'::text))),
  CONSTRAINT lr_b2b_accounts_brand_font_check CHECK (((brand_font IS NULL) OR (brand_font = ANY (ARRAY['sans'::text, 'serif'::text, 'klassisch'::text])))),
  CONSTRAINT lr_b2b_accounts_city_check CHECK (((char_length(city) >= 2) AND (char_length(city) <= 80))),
  CONSTRAINT lr_b2b_accounts_company_name_check CHECK (((char_length(company_name) >= 2) AND (char_length(company_name) <= 160))),
  CONSTRAINT lr_b2b_accounts_custom_disclaimer_check CHECK (((custom_disclaimer IS NULL) OR (char_length(custom_disclaimer) <= 600))),
  CONSTRAINT lr_b2b_accounts_doc_footer_check CHECK (((doc_footer IS NULL) OR (char_length(doc_footer) <= 400))),
  CONSTRAINT lr_b2b_accounts_doc_sender_check CHECK (((doc_sender IS NULL) OR (char_length(doc_sender) <= 160))),
  CONSTRAINT lr_b2b_accounts_doc_title_check CHECK (((doc_title IS NULL) OR (char_length(doc_title) <= 80))),
  CONSTRAINT lr_b2b_accounts_dossier_bonus_check CHECK ((dossier_bonus >= 0)),
  CONSTRAINT lr_b2b_accounts_email_check CHECK ((char_length(email) <= 200)),
  CONSTRAINT lr_b2b_accounts_extra_branches_check CHECK (((extra_branches <@ ARRAY['bank'::text, 'vermittler'::text, 'makler'::text, 'finanzberater'::text, 'allgemein'::text]) AND (cardinality(extra_branches) <= 4))),
  CONSTRAINT lr_b2b_accounts_institution_type_check CHECK ((institution_type = ANY (ARRAY['BANK'::text, 'BROKER'::text, 'REALTOR'::text, 'ADVISOR'::text, 'OTHER'::text]))),
  CONSTRAINT lr_b2b_accounts_invoice_limit_cents_check CHECK (((invoice_limit_cents IS NULL) OR (invoice_limit_cents >= 0))),
  CONSTRAINT lr_b2b_accounts_lead_retention_months_check CHECK (((lead_retention_months >= 1) AND (lead_retention_months <= 120))),
  CONSTRAINT lr_b2b_accounts_legal_form_check CHECK (((char_length(legal_form) >= 1) AND (char_length(legal_form) <= 60))),
  CONSTRAINT lr_b2b_accounts_modules_obj CHECK ((jsonb_typeof(modules) = 'object'::text)),
  CONSTRAINT lr_b2b_accounts_payment_terms_days_check CHECK (((payment_terms_days >= 0) AND (payment_terms_days <= 90))),
  CONSTRAINT lr_b2b_accounts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40))),
  CONSTRAINT lr_b2b_accounts_plan_source_check CHECK ((plan_source = ANY (ARRAY['stripe'::text, 'manual'::text]))),
  CONSTRAINT lr_b2b_accounts_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['BASIC'::text, 'PRO'::text, 'ENTERPRISE'::text]))),
  CONSTRAINT lr_b2b_accounts_postal_code_check CHECK ((postal_code ~ '^[0-9]{5}$'::text)),
  CONSTRAINT lr_b2b_accounts_referral_check CHECK (((referral IS NULL) OR (char_length(referral) <= 40))),
  CONSTRAINT lr_b2b_accounts_register_number_check CHECK (((register_number IS NULL) OR (char_length(register_number) <= 60))),
  CONSTRAINT lr_b2b_accounts_slug_check CHECK (((slug IS NULL) OR (slug ~ '^[a-z0-9-]{3,40}$'::text))),
  CONSTRAINT lr_b2b_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'locked'::text]))),
  CONSTRAINT lr_b2b_accounts_street_check CHECK (((street IS NULL) OR (char_length(street) <= 160))),
  CONSTRAINT lr_b2b_accounts_tax_id_check CHECK (((tax_id IS NULL) OR (char_length(tax_id) <= 40))),
  CONSTRAINT lr_b2b_accounts_verification_note_check CHECK (((verification_note IS NULL) OR (char_length(verification_note) <= 600))),
  CONSTRAINT lr_b2b_accounts_verification_status_check CHECK ((verification_status = ANY (ARRAY['offen'::text, 'eingereicht'::text, 'geprueft'::text, 'abgelehnt'::text]))),
  CONSTRAINT lr_b2b_accounts_webhook_url_check CHECK (((webhook_url IS NULL) OR ((webhook_url ~ '^https://'::text) AND (char_length(webhook_url) <= 300)))),
  CONSTRAINT lr_b2b_ident CHECK (((COALESCE(register_number, ''::text) <> ''::text) OR (COALESCE(tax_id, ''::text) <> ''::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_clients (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  account_id uuid NOT NULL,
  invited_by uuid,
  client_name text,
  client_email text,
  token_hash text,
  expires_at timestamp with time zone,
  client_user_id uuid,
  status text DEFAULT 'eingeladen'::text NOT NULL,
  consent_at timestamp with time zone,
  consent_text text,
  ended_at timestamp with time zone,
  ended_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_request_at timestamp with time zone,
  request_note text,
  request_seen_at timestamp with time zone,
  ready_notified_at timestamp with time zone,
  radar_consent_at timestamp with time zone,
  radar_consent_text text,
  inviter_consent_at timestamp with time zone,
  CONSTRAINT lr_b2b_clients_token_hash_key UNIQUE (token_hash),
  CONSTRAINT lr_b2b_clients_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_clients_status_check CHECK ((status = ANY (ARRAY['eingeladen'::text, 'verbunden'::text, 'getrennt'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  company text NOT NULL,
  email text NOT NULL,
  phone text,
  message text,
  status text DEFAULT 'offen'::text NOT NULL,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
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
  proof_sha256 text,
  CONSTRAINT lr_b2b_contact_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_contact_company_check CHECK (((char_length(company) >= 2) AND (char_length(company) <= 160))),
  CONSTRAINT lr_b2b_contact_email_check CHECK ((char_length(email) <= 200)),
  CONSTRAINT lr_b2b_contact_kind_check CHECK ((kind = ANY (ARRAY['demo'::text, 'enterprise'::text, 'kooperation'::text, 'konto'::text]))),
  CONSTRAINT lr_b2b_contact_legal_form_check CHECK (((legal_form IS NULL) OR (char_length(legal_form) <= 60))),
  CONSTRAINT lr_b2b_contact_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000))),
  CONSTRAINT lr_b2b_contact_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120))),
  CONSTRAINT lr_b2b_contact_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40))),
  CONSTRAINT lr_b2b_contact_proof_kind_check CHECK (((proof_kind IS NULL) OR (proof_kind = ANY (ARRAY['gewerbe'::text, 'handelsregister'::text, 'erlaubnis'::text, 'sonstiges'::text])))),
  CONSTRAINT lr_b2b_contact_proof_name_check CHECK (((proof_name IS NULL) OR (char_length(proof_name) <= 140))),
  CONSTRAINT lr_b2b_contact_register_number_check CHECK (((register_number IS NULL) OR (char_length(register_number) <= 60))),
  CONSTRAINT lr_b2b_contact_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'erledigt'::text]))),
  CONSTRAINT lr_b2b_contact_tax_id_check CHECK (((tax_id IS NULL) OR (char_length(tax_id) <= 40)))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  account_id uuid NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT lr_b2b_invites_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  account_id uuid NOT NULL,
  source text NOT NULL,
  client_name text NOT NULL,
  client_email text NOT NULL,
  client_phone text,
  message text,
  property_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  metrics jsonb,
  consent_at timestamp with time zone NOT NULL,
  consent_text text NOT NULL,
  status text DEFAULT 'neu'::text NOT NULL,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  assigned_to uuid,
  notes text,
  CONSTRAINT lr_b2b_leads_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_leads_client_email_check CHECK ((char_length(client_email) <= 200)),
  CONSTRAINT lr_b2b_leads_client_name_check CHECK (((char_length(client_name) >= 2) AND (char_length(client_name) <= 120))),
  CONSTRAINT lr_b2b_leads_client_phone_check CHECK (((client_phone IS NULL) OR (char_length(client_phone) <= 40))),
  CONSTRAINT lr_b2b_leads_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000))),
  CONSTRAINT lr_b2b_leads_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000))),
  CONSTRAINT lr_b2b_leads_source_check CHECK ((source = ANY (ARRAY['widget'::text, 'landing'::text, 'qr'::text]))),
  CONSTRAINT lr_b2b_leads_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'in_bearbeitung'::text, 'abgeschlossen'::text, 'abgelehnt'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_members (
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_members_pkey PRIMARY KEY (account_id, user_id),
  CONSTRAINT lr_b2b_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'advisor'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_partner_codes (
  code text NOT NULL,
  description text,
  active boolean DEFAULT true NOT NULL,
  max_redemptions integer,
  redeemed integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_partner_codes_pkey PRIMARY KEY (code),
  CONSTRAINT lr_b2b_partner_codes_code_check CHECK ((code ~ '^[A-Z0-9-]{3,30}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_account_id uuid NOT NULL,
  from_user_id uuid,
  to_account_id uuid NOT NULL,
  version_id uuid,
  object_label text,
  note text,
  consent_confirmed_at timestamp with time zone NOT NULL,
  status text DEFAULT 'eingegangen'::text NOT NULL,
  reply text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_submissions_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000))),
  CONSTRAINT lr_b2b_submissions_object_label_check CHECK (((object_label IS NULL) OR (char_length(object_label) <= 160))),
  CONSTRAINT lr_b2b_submissions_reply_check CHECK (((reply IS NULL) OR (char_length(reply) <= 1000))),
  CONSTRAINT lr_b2b_submissions_status_check CHECK ((status = ANY (ARRAY['eingegangen'::text, 'in_pruefung'::text, 'rueckfrage'::text, 'abgeschlossen'::text, 'abgelehnt'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_usage (
  account_id uuid NOT NULL,
  month text NOT NULL,
  kind text NOT NULL,
  n integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_usage_pkey PRIMARY KEY (account_id, month, kind),
  CONSTRAINT lr_b2b_usage_kind_check CHECK ((kind = ANY (ARRAY['fall'::text, 'praesentation'::text]))),
  CONSTRAINT lr_b2b_usage_month_check CHECK ((month ~ '^[0-9]{4}-[0-9]{2}$'::text)),
  CONSTRAINT lr_b2b_usage_n_check CHECK ((n >= 0))
);
CREATE TABLE IF NOT EXISTS public.lr_b2b_verification_docs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_b2b_verification_docs_pkey PRIMARY KEY (id),
  CONSTRAINT lr_b2b_verification_docs_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 10485760))),
  CONSTRAINT lr_b2b_verification_docs_file_name_check CHECK ((char_length(file_name) <= 160)),
  CONSTRAINT lr_b2b_verification_docs_kind_check CHECK ((kind = ANY (ARRAY['gewerbe'::text, 'handelsregister'::text, 'erlaubnis'::text, 'sonstiges'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_bank_packages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  deal_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  package jsonb DEFAULT '{}'::jsonb NOT NULL,
  qr_share_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_bank_packages_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_bank_pdf_audit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pdf_version_id uuid NOT NULL,
  package_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_bank_pdf_audit_pkey PRIMARY KEY (id),
  CONSTRAINT lr_bank_pdf_audit_event_type_check CHECK ((event_type = ANY (ARRAY['generated'::text, 'downloaded'::text, 'shared'::text, 'revoked'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_bank_pdf_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  package_id uuid NOT NULL,
  version_no integer NOT NULL,
  sha256_hex text NOT NULL,
  storage_bucket text DEFAULT 'bank-ready-pdf'::text NOT NULL,
  storage_path text NOT NULL,
  mime_type text DEFAULT 'application/pdf'::text NOT NULL,
  byte_size bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_bank_pdf_versions_package_id_sha256_hex_key UNIQUE (package_id, sha256_hex),
  CONSTRAINT lr_bank_pdf_versions_package_id_version_no_key UNIQUE (package_id, version_no),
  CONSTRAINT lr_bank_pdf_versions_storage_bucket_storage_path_key UNIQUE (storage_bucket, storage_path),
  CONSTRAINT lr_bank_pdf_versions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_bank_pdf_versions_byte_size_check CHECK ((byte_size > 0)),
  CONSTRAINT lr_bank_pdf_versions_sha256_hex_check CHECK ((sha256_hex ~ '^[0-9a-f]{64}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_bank_share_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  share_link_id uuid NOT NULL,
  package_id uuid NOT NULL,
  pdf_version_id uuid,
  event_type text NOT NULL,
  actor_id uuid,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_bank_share_events_pkey PRIMARY KEY (id),
  CONSTRAINT lr_bank_share_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'opened'::text, 'downloaded'::text, 'revoked'::text, 'expired'::text, 'denied'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_bank_share_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  package_id uuid NOT NULL,
  pdf_version_id uuid,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  max_uses integer,
  use_count integer DEFAULT 0 NOT NULL,
  last_failed_at timestamp with time zone,
  failed_attempts integer DEFAULT 0 NOT NULL,
  CONSTRAINT lr_bank_share_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT lr_bank_share_links_pkey PRIMARY KEY (id),
  CONSTRAINT lr_bank_share_links_check CHECK ((expires_at > created_at)),
  CONSTRAINT lr_bank_share_links_failed_attempts_check CHECK ((failed_attempts >= 0)),
  CONSTRAINT lr_bank_share_links_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0))),
  CONSTRAINT lr_bank_share_links_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_bank_share_links_use_count_check CHECK ((use_count >= 0))
);
CREATE TABLE IF NOT EXISTS public.lr_bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  topic text NOT NULL,
  message text,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  status text DEFAULT 'angefragt'::text NOT NULL,
  teams_url text,
  ms_event_id text,
  note text,
  decided_at timestamp with time zone,
  decided_by text,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_bookings_token_key UNIQUE (token),
  CONSTRAINT lr_bookings_pkey PRIMARY KEY (id),
  CONSTRAINT lr_bookings_check CHECK ((ends_at > starts_at)),
  CONSTRAINT lr_bookings_company_check CHECK (((company IS NULL) OR (char_length(company) <= 160))),
  CONSTRAINT lr_bookings_email_check CHECK ((char_length(email) <= 200)),
  CONSTRAINT lr_bookings_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000))),
  CONSTRAINT lr_bookings_ms_event_id_check CHECK (((ms_event_id IS NULL) OR (char_length(ms_event_id) <= 500))),
  CONSTRAINT lr_bookings_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120))),
  CONSTRAINT lr_bookings_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000))),
  CONSTRAINT lr_bookings_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40))),
  CONSTRAINT lr_bookings_status_check CHECK ((status = ANY (ARRAY['angefragt'::text, 'bestaetigt'::text, 'abgelehnt'::text, 'abgesagt'::text]))),
  CONSTRAINT lr_bookings_teams_url_check CHECK (((teams_url IS NULL) OR (char_length(teams_url) <= 2000))),
  CONSTRAINT lr_bookings_token_check CHECK ((token ~ '^[A-Za-z0-9_-]{20,64}$'::text)),
  CONSTRAINT lr_bookings_topic_check CHECK ((char_length(topic) <= 120))
);
CREATE TABLE IF NOT EXISTS public.lr_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  channel text NOT NULL,
  segment text DEFAULT 'b2b'::text NOT NULL,
  target_path text DEFAULT '/b2b'::text NOT NULL,
  notes text,
  active boolean DEFAULT true NOT NULL,
  CONSTRAINT lr_campaigns_slug_key UNIQUE (slug),
  CONSTRAINT lr_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT lr_campaigns_channel_check CHECK ((channel = ANY (ARRAY['brief'::text, 'qr'::text, 'link'::text, 'newsletter'::text, 'social'::text, 'anzeige'::text, 'messe'::text]))),
  CONSTRAINT lr_campaigns_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120))),
  CONSTRAINT lr_campaigns_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 1000))),
  CONSTRAINT lr_campaigns_segment_check CHECK ((segment = ANY (ARRAY['b2b'::text, 'b2c'::text]))),
  CONSTRAINT lr_campaigns_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,40}$'::text)),
  CONSTRAINT lr_campaigns_target_path_check CHECK ((target_path ~ '^/[a-z0-9/_-]*$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_card_applications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  product_type text NOT NULL,
  design text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  kyc_status text DEFAULT 'NOT_STARTED'::text NOT NULL,
  provider_status text DEFAULT 'NOT_CONFIGURED'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_card_applications_pkey PRIMARY KEY (id),
  CONSTRAINT lr_card_applications_design_check CHECK ((design = ANY (ARRAY['classic-black'::text, 'platinum'::text, 'minimal-white'::text]))),
  CONSTRAINT lr_card_applications_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['NOT_STARTED'::text, 'STARTED'::text, 'KYC_PENDING'::text, 'KYC_VERIFIED'::text, 'KYC_FAILED'::text]))),
  CONSTRAINT lr_card_applications_product_type_check CHECK ((product_type = ANY (ARRAY['debit'::text, 'charge'::text]))),
  CONSTRAINT lr_card_applications_provider_status_check CHECK ((provider_status = ANY (ARRAY['NOT_CONFIGURED'::text, 'PROVIDER_PENDING'::text, 'PROVIDER_ERROR'::text, 'READY'::text]))),
  CONSTRAINT lr_card_applications_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_card_audit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  card_id uuid,
  user_id uuid,
  actor text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  ip_hash text,
  request_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_card_audit_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_card_limits (
  card_id uuid NOT NULL,
  monthly_limit_cents bigint NOT NULL,
  settled_cents bigint DEFAULT 0 NOT NULL,
  reserved_cents bigint DEFAULT 0 NOT NULL,
  refunded_cents bigint DEFAULT 0 NOT NULL,
  security_deposit_cents bigint DEFAULT 0 NOT NULL,
  refunds_release_limit boolean DEFAULT true NOT NULL,
  reset_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_card_limits_pkey PRIMARY KEY (card_id),
  CONSTRAINT lr_card_limits_monthly_limit_cents_check CHECK ((monthly_limit_cents >= 0)),
  CONSTRAINT lr_card_limits_refunded_cents_check CHECK ((refunded_cents >= 0)),
  CONSTRAINT lr_card_limits_reserved_cents_check CHECK ((reserved_cents >= 0)),
  CONSTRAINT lr_card_limits_security_deposit_cents_check CHECK ((security_deposit_cents >= 0)),
  CONSTRAINT lr_card_limits_settled_cents_check CHECK ((settled_cents >= 0))
);
CREATE TABLE IF NOT EXISTS public.lr_card_pricing_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  version_id uuid NOT NULL,
  chapter smallint NOT NULL,
  "position" smallint DEFAULT 0 NOT NULL,
  product text NOT NULL,
  name text NOT NULL,
  amount_cents bigint,
  currency text DEFAULT 'EUR'::text NOT NULL,
  unit text,
  note text,
  active boolean DEFAULT true NOT NULL,
  CONSTRAINT lr_card_pricing_items_pkey PRIMARY KEY (id),
  CONSTRAINT lr_card_pricing_items_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
  CONSTRAINT lr_card_pricing_items_chapter_check CHECK (((chapter >= 1) AND (chapter <= 30))),
  CONSTRAINT lr_card_pricing_items_name_check CHECK ((char_length(name) <= 160)),
  CONSTRAINT lr_card_pricing_items_note_check CHECK (((note IS NULL) OR (char_length(note) <= 600))),
  CONSTRAINT lr_card_pricing_items_product_check CHECK ((product = ANY (ARRAY['all'::text, 'debit'::text, 'charge'::text]))),
  CONSTRAINT lr_card_pricing_items_unit_check CHECK (((unit IS NULL) OR (char_length(unit) <= 60)))
);
CREATE TABLE IF NOT EXISTS public.lr_card_pricing_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id text NOT NULL,
  version text NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  effective_from date,
  document_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_card_pricing_versions_document_id_version_key UNIQUE (document_id, version),
  CONSTRAINT lr_card_pricing_versions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_card_pricing_versions_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_card_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  card_id uuid NOT NULL,
  kind text NOT NULL,
  parent_id uuid,
  idempotency_key text NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL,
  merchant text,
  category text,
  available_before_cents bigint NOT NULL,
  available_after_cents bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_card_transactions_card_id_idempotency_key_key UNIQUE (card_id, idempotency_key),
  CONSTRAINT lr_card_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_card_transactions_amount_cents_check CHECK (((amount_cents > 0) AND (amount_cents <= 100000000))),
  CONSTRAINT lr_card_transactions_category_check CHECK (((category IS NULL) OR (char_length(category) <= 60))),
  CONSTRAINT lr_card_transactions_idempotency_key_check CHECK (((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 120))),
  CONSTRAINT lr_card_transactions_kind_check CHECK ((kind = ANY (ARRAY['authorization'::text, 'refund'::text]))),
  CONSTRAINT lr_card_transactions_merchant_check CHECK (((merchant IS NULL) OR (char_length(merchant) <= 120))),
  CONSTRAINT lr_card_transactions_status_check CHECK ((status = ANY (ARRAY['AUTHORIZED'::text, 'SETTLED'::text, 'RELEASED'::text, 'REFUNDED'::text, 'DECLINED_LIMIT_EXCEEDED'::text, 'DECLINED_CARD_FROZEN'::text, 'DECLINED_CARD_INACTIVE'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_cards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  design text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  last4 text,
  provider text,
  provider_ref text,
  cardholder_ref text,
  stripe_account text,
  b2b_account_id uuid,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_cards_provider_ref_key UNIQUE (provider_ref),
  CONSTRAINT lr_cards_pkey PRIMARY KEY (id),
  CONSTRAINT lr_cards_design_check CHECK ((design = ANY (ARRAY['classic-black'::text, 'platinum'::text, 'minimal-white'::text]))),
  CONSTRAINT lr_cards_last4_check CHECK (((last4 IS NULL) OR (last4 ~ '^[0-9]{4}$'::text))),
  CONSTRAINT lr_cards_provider_check CHECK (((provider IS NULL) OR (provider = 'stripe'::text))),
  CONSTRAINT lr_cards_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PENDING'::text, 'FROZEN'::text, 'BLOCKED'::text]))),
  CONSTRAINT lr_cards_stripe_account_check CHECK (((stripe_account IS NULL) OR (stripe_account ~ '^acct_[A-Za-z0-9]+$'::text))),
  CONSTRAINT lr_cards_type_check CHECK ((type = ANY (ARRAY['debit'::text, 'charge'::text, 'business'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_client_errors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fingerprint text NOT NULL,
  message text NOT NULL,
  source text,
  page text,
  area text,
  browser text,
  count integer DEFAULT 1 NOT NULL,
  first_seen timestamp with time zone DEFAULT now() NOT NULL,
  last_seen timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT lr_client_errors_fingerprint_key UNIQUE (fingerprint),
  CONSTRAINT lr_client_errors_pkey PRIMARY KEY (id)
);

-- ===================== 1b.sql =====================
CREATE TABLE IF NOT EXISTS public.lr_creator_adjustments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  period text NOT NULL,
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  reason text NOT NULL,
  source_id uuid,
  statement_id uuid,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_adjustments_kind_source_id_key UNIQUE (kind, source_id),
  CONSTRAINT lr_creator_adjustments_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_adjustments_amount_cents_check CHECK (((amount_cents <> 0) AND (abs(amount_cents) <= 100000000))),
  CONSTRAINT lr_creator_adjustments_kind_check CHECK ((kind = ANY (ARRAY['BONUS'::text, 'CORRECTION'::text, 'CLAWBACK'::text, 'CARRY_OVER'::text]))),
  CONSTRAINT lr_creator_adjustments_period_check CHECK ((period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'::text)),
  CONSTRAINT lr_creator_adjustments_reason_check CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 300)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_admin_roles (
  email text NOT NULL,
  role text NOT NULL,
  granted_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_admin_roles_pkey PRIMARY KEY (email),
  CONSTRAINT lr_creator_admin_roles_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
  CONSTRAINT lr_creator_admin_roles_role_check CHECK ((role = ANY (ARRAY['SUPER_ADMIN'::text, 'FINANCE_ADMIN'::text, 'CREATOR_MANAGER'::text, 'SUPPORT'::text, 'READ_ONLY'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_agreement_acceptances (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  body_sha256 text NOT NULL,
  ip_hash text,
  accepted_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_agreement_acceptances_creator_id_agreement_id_key UNIQUE (creator_id, agreement_id),
  CONSTRAINT lr_creator_agreement_acceptances_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_agreement_acceptances_body_sha256_check CHECK ((body_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_creator_agreement_acceptances_ip_hash_check CHECK (((ip_hash IS NULL) OR (ip_hash ~ '^[0-9a-f]{32}$'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_agreements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  body_sha256 text NOT NULL,
  is_draft boolean DEFAULT true NOT NULL,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_agreements_version_key UNIQUE (version),
  CONSTRAINT lr_creator_agreements_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_agreements_body_check CHECK (((char_length(body) >= 50) AND (char_length(body) <= 60000))),
  CONSTRAINT lr_creator_agreements_body_sha256_check CHECK ((body_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_creator_agreements_title_check CHECK (((char_length(title) >= 3) AND (char_length(title) <= 160))),
  CONSTRAINT lr_creator_agreements_version_check CHECK ((version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]+)?$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  campaign_id uuid,
  title text NOT NULL,
  description text,
  kind text NOT NULL,
  storage_path text,
  mime text,
  size_bytes bigint,
  text_body text,
  usage_notes text,
  active boolean DEFAULT false NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_assets_storage_path_key UNIQUE (storage_path),
  CONSTRAINT lr_creator_assets_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_assets_check CHECK ((((kind = 'text'::text) AND (text_body IS NOT NULL) AND (storage_path IS NULL)) OR ((kind <> 'text'::text) AND (storage_path IS NOT NULL)))),
  CONSTRAINT lr_creator_assets_description_check CHECK (((description IS NULL) OR (char_length(description) <= 1000))),
  CONSTRAINT lr_creator_assets_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text, 'document'::text, 'logo'::text, 'text'::text]))),
  CONSTRAINT lr_creator_assets_mime_check CHECK (((mime IS NULL) OR (char_length(mime) <= 100))),
  CONSTRAINT lr_creator_assets_size_bytes_check CHECK (((size_bytes IS NULL) OR ((size_bytes >= 1) AND (size_bytes <= 524288000)))),
  CONSTRAINT lr_creator_assets_storage_path_check CHECK (((storage_path IS NULL) OR (storage_path ~ '^assets/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'::text))),
  CONSTRAINT lr_creator_assets_text_body_check CHECK (((text_body IS NULL) OR (char_length(text_body) <= 8000))),
  CONSTRAINT lr_creator_assets_title_check CHECK (((char_length(title) >= 2) AND (char_length(title) <= 140))),
  CONSTRAINT lr_creator_assets_usage_notes_check CHECK (((usage_notes IS NULL) OR (char_length(usage_notes) <= 1000)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_attributions (
  user_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  campaign_slug text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_attributions_pkey PRIMARY KEY (user_id),
  CONSTRAINT lr_creator_attributions_campaign_slug_check CHECK (((campaign_slug IS NULL) OR (campaign_slug ~ '^[a-z0-9-]{3,40}$'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_audit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  event_type text NOT NULL,
  creator_id uuid,
  actor_kind text NOT NULL,
  actor_ref text NOT NULL,
  actor_role text,
  result text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_audit_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_audit_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['creator'::text, 'admin'::text, 'system'::text]))),
  CONSTRAINT lr_creator_audit_actor_ref_check CHECK ((char_length(actor_ref) <= 64)),
  CONSTRAINT lr_creator_audit_actor_role_check CHECK (((actor_role IS NULL) OR (actor_role = ANY (ARRAY['CREATOR'::text, 'SUPER_ADMIN'::text, 'FINANCE_ADMIN'::text, 'CREATOR_MANAGER'::text, 'SUPPORT'::text, 'READ_ONLY'::text, 'SYSTEM'::text])))),
  CONSTRAINT lr_creator_audit_event_type_check CHECK ((event_type = ANY (ARRAY['CREATOR_CREATED'::text, 'APPLICATION_SUBMITTED'::text, 'REVIEW_STARTED'::text, 'CREATOR_APPROVED'::text, 'CREATOR_INFO_REQUESTED'::text, 'CREATOR_REJECTED'::text, 'CREATOR_SUSPENDED'::text, 'CREATOR_REACTIVATED'::text, 'AGREEMENT_ACCEPTED'::text, 'BANK_DATA_ADDED'::text, 'BANK_DATA_CHANGED'::text, 'BANK_DETAILS_VIEWED'::text, 'BANK_DATA_VERIFIED'::text, 'ADMIN_ROLE_CHANGED'::text, 'ACCESS_DENIED'::text, 'CAMPAIGN_CHANGED'::text, 'CAMPAIGN_MEMBERS_CHANGED'::text, 'ASSET_CHANGED'::text, 'ASSET_DOWNLOADED'::text, 'BENEFIT_CHANGED'::text, 'CONTENT_SUBMITTED'::text, 'CONTENT_REVIEWED'::text, 'CONVERSION_RECORDED'::text, 'CONVERSION_REVERSED'::text, 'COMMISSION_CHANGED'::text, 'ADJUSTMENT_CREATED'::text, 'PERIOD_CLOSED'::text, 'BILLING_MODE_CHANGED'::text, 'STATEMENT_APPROVED'::text, 'DOCUMENT_DOWNLOADED'::text, 'INVOICE_CREATED'::text, 'INVOICE_APPROVED'::text, 'INVOICE_REJECTED'::text, 'PAYOUT_CREATED'::text, 'PAYOUT_APPROVED'::text, 'PAYOUT_EXPORTED'::text, 'PAYOUT_PAID'::text, 'PAYOUT_FAILED'::text, 'CREATOR_ACCOUNT_DELETED'::text, 'REFUND_RECORDED'::text, 'BANK_STATEMENT_IMPORTED'::text, 'CREATOR_NOTIFIED'::text, 'SETTINGS_CHANGED'::text, 'PAYOUT_RETURNED'::text, 'PAYOUT_REISSUED'::text]))),
  CONSTRAINT lr_creator_audit_meta_check CHECK ((pg_column_size(meta) <= 4096)),
  CONSTRAINT lr_creator_audit_result_check CHECK ((result = ANY (ARRAY['SUCCESS'::text, 'DENIED'::text, 'FAILED'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_bank_imports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  file_sha256 text NOT NULL,
  statement_id text,
  account_last4 text,
  entries integer NOT NULL,
  matched integer NOT NULL,
  imported_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_bank_imports_file_sha256_key UNIQUE (file_sha256),
  CONSTRAINT lr_creator_bank_imports_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_bank_imports_account_last4_check CHECK (((account_last4 IS NULL) OR (account_last4 ~ '^[0-9A-Z]{4}$'::text))),
  CONSTRAINT lr_creator_bank_imports_entries_check CHECK ((entries >= 0)),
  CONSTRAINT lr_creator_bank_imports_file_sha256_check CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_creator_bank_imports_matched_check CHECK ((matched >= 0)),
  CONSTRAINT lr_creator_bank_imports_statement_id_check CHECK (((statement_id IS NULL) OR (char_length(statement_id) <= 80)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_benefits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  campaign_id uuid,
  code text NOT NULL,
  benefit text NOT NULL,
  terms text,
  starts_at timestamp with time zone DEFAULT now() NOT NULL,
  ends_at timestamp with time zone,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_benefits_code_key UNIQUE (code),
  CONSTRAINT lr_creator_benefits_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_benefits_benefit_check CHECK (((char_length(benefit) >= 3) AND (char_length(benefit) <= 200))),
  CONSTRAINT lr_creator_benefits_check CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
  CONSTRAINT lr_creator_benefits_code_check CHECK ((code ~ '^[A-Z0-9]{3,20}$'::text)),
  CONSTRAINT lr_creator_benefits_terms_check CHECK (((terms IS NULL) OR (char_length(terms) <= 2000)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_business (
  creator_id uuid NOT NULL,
  entity_type text NOT NULL,
  legal_name text NOT NULL,
  legal_form text,
  street text NOT NULL,
  postal_code text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  tax_number text,
  vat_id text,
  vat_status text NOT NULL,
  billing_email text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_business_pkey PRIMARY KEY (creator_id),
  CONSTRAINT lr_creator_business_billing_email_check CHECK (((char_length(billing_email) <= 200) AND (billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
  CONSTRAINT lr_creator_business_city_check CHECK (((char_length(city) >= 2) AND (char_length(city) <= 80))),
  CONSTRAINT lr_creator_business_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT lr_creator_business_entity_type_check CHECK ((entity_type = ANY (ARRAY['individual'::text, 'company'::text]))),
  CONSTRAINT lr_creator_business_legal_form_check CHECK (((legal_form IS NULL) OR (char_length(legal_form) <= 60))),
  CONSTRAINT lr_creator_business_legal_name_check CHECK (((char_length(legal_name) >= 2) AND (char_length(legal_name) <= 160))),
  CONSTRAINT lr_creator_business_postal_code_check CHECK (((char_length(postal_code) >= 3) AND (char_length(postal_code) <= 12))),
  CONSTRAINT lr_creator_business_street_check CHECK (((char_length(street) >= 3) AND (char_length(street) <= 160))),
  CONSTRAINT lr_creator_business_tax_number_check CHECK (((tax_number IS NULL) OR (char_length(tax_number) <= 30))),
  CONSTRAINT lr_creator_business_vat_id_check CHECK (((vat_id IS NULL) OR (vat_id ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'::text))),
  CONSTRAINT lr_creator_business_vat_status_check CHECK ((vat_status = ANY (ARRAY['small_business'::text, 'vat_registered'::text, 'not_applicable'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_campaign_members (
  campaign_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  added_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_campaign_members_pkey PRIMARY KEY (campaign_id, creator_id)
);
CREATE TABLE IF NOT EXISTS public.lr_creator_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  summary text,
  brief text,
  dos text,
  donts text,
  target_path text DEFAULT '/'::text NOT NULL,
  audience text DEFAULT 'ALL'::text NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  starts_on date,
  ends_on date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_campaigns_slug_key UNIQUE (slug),
  CONSTRAINT lr_creator_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_campaigns_audience_check CHECK ((audience = ANY (ARRAY['ALL'::text, 'SELECTED'::text]))),
  CONSTRAINT lr_creator_campaigns_brief_check CHECK (((brief IS NULL) OR (char_length(brief) <= 8000))),
  CONSTRAINT lr_creator_campaigns_check CHECK (((ends_on IS NULL) OR (starts_on IS NULL) OR (ends_on >= starts_on))),
  CONSTRAINT lr_creator_campaigns_donts_check CHECK (((donts IS NULL) OR (char_length(donts) <= 4000))),
  CONSTRAINT lr_creator_campaigns_dos_check CHECK (((dos IS NULL) OR (char_length(dos) <= 4000))),
  CONSTRAINT lr_creator_campaigns_name_check CHECK (((char_length(name) >= 3) AND (char_length(name) <= 120))),
  CONSTRAINT lr_creator_campaigns_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,40}$'::text)),
  CONSTRAINT lr_creator_campaigns_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'PAUSED'::text, 'ENDED'::text]))),
  CONSTRAINT lr_creator_campaigns_summary_check CHECK (((summary IS NULL) OR (char_length(summary) <= 600))),
  CONSTRAINT lr_creator_campaigns_target_path_check CHECK (((target_path ~ '^/[A-Za-z0-9/_\-]*$'::text) AND (char_length(target_path) <= 120)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_commission_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  creator_id uuid,
  campaign_slug text,
  kind text NOT NULL,
  percent_bps integer DEFAULT 0 NOT NULL,
  fixed_cents integer DEFAULT 0 NOT NULL,
  tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
  valid_from timestamp with time zone DEFAULT now() NOT NULL,
  valid_to timestamp with time zone,
  note text,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_commission_rules_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_commission_rules_campaign_slug_check CHECK (((campaign_slug IS NULL) OR (campaign_slug ~ '^[a-z0-9-]{3,40}$'::text))),
  CONSTRAINT lr_creator_commission_rules_check CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
  CONSTRAINT lr_creator_commission_rules_fixed_cents_check CHECK (((fixed_cents >= 0) AND (fixed_cents <= 1000000))),
  CONSTRAINT lr_creator_commission_rules_kind_check CHECK ((kind = ANY (ARRAY['PERCENT'::text, 'FIXED'::text, 'HYBRID'::text, 'TIERED'::text]))),
  CONSTRAINT lr_creator_commission_rules_note_check CHECK (((note IS NULL) OR (char_length(note) <= 300))),
  CONSTRAINT lr_creator_commission_rules_percent_bps_check CHECK (((percent_bps >= 0) AND (percent_bps <= 10000))),
  CONSTRAINT lr_creator_commission_rules_tiers_check CHECK (((jsonb_typeof(tiers) = 'array'::text) AND (jsonb_array_length(tiers) <= 10))),
  CONSTRAINT lr_creator_commission_rules_version_check CHECK ((version >= 1))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_commissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversion_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  period text NOT NULL,
  rule_id uuid,
  rule_version integer,
  base_cents bigint NOT NULL,
  commission_cents bigint NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_commissions_conversion_id_key UNIQUE (conversion_id),
  CONSTRAINT lr_creator_commissions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_commissions_base_cents_check CHECK ((base_cents >= 0)),
  CONSTRAINT lr_creator_commissions_commission_cents_check CHECK ((commission_cents >= 0)),
  CONSTRAINT lr_creator_commissions_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'PAID'::text, 'CLAWED_BACK'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_content (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  campaign_id uuid,
  platform text NOT NULL,
  url text NOT NULL,
  title text,
  published_on date NOT NULL,
  ad_disclosure boolean NOT NULL,
  status text DEFAULT 'SUBMITTED'::text NOT NULL,
  review_note text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_content_creator_id_url_key UNIQUE (creator_id, url),
  CONSTRAINT lr_creator_content_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_content_platform_check CHECK ((platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'x'::text, 'linkedin'::text, 'other'::text]))),
  CONSTRAINT lr_creator_content_review_note_check CHECK (((review_note IS NULL) OR (char_length(review_note) <= 1000))),
  CONSTRAINT lr_creator_content_status_check CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'APPROVED'::text, 'CHANGES_REQUESTED'::text]))),
  CONSTRAINT lr_creator_content_title_check CHECK (((title IS NULL) OR (char_length(title) <= 160))),
  CONSTRAINT lr_creator_content_url_check CHECK (((char_length(url) <= 300) AND (url ~ '^https://'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_conversions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  user_id uuid,
  campaign_slug text,
  source text NOT NULL,
  benefit_id uuid,
  stripe_session_id text NOT NULL,
  stripe_payment_intent text,
  plan text,
  currency text DEFAULT 'eur'::text NOT NULL,
  amount_net_cents bigint NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  reversed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_conversions_stripe_session_id_key UNIQUE (stripe_session_id),
  CONSTRAINT lr_creator_conversions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_conversions_amount_net_cents_check CHECK ((amount_net_cents >= 0)),
  CONSTRAINT lr_creator_conversions_campaign_slug_check CHECK (((campaign_slug IS NULL) OR (campaign_slug ~ '^[a-z0-9-]{3,40}$'::text))),
  CONSTRAINT lr_creator_conversions_currency_check CHECK ((currency ~ '^[a-z]{3}$'::text)),
  CONSTRAINT lr_creator_conversions_plan_check CHECK (((plan IS NULL) OR (char_length(plan) <= 40))),
  CONSTRAINT lr_creator_conversions_source_check CHECK ((source = ANY (ARRAY['link'::text, 'code'::text]))),
  CONSTRAINT lr_creator_conversions_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'REVERSED'::text]))),
  CONSTRAINT lr_creator_conversions_stripe_payment_intent_check CHECK (((stripe_payment_intent IS NULL) OR (stripe_payment_intent ~ '^pi_[A-Za-z0-9_]+$'::text))),
  CONSTRAINT lr_creator_conversions_stripe_session_id_check CHECK ((stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  doc_type text NOT NULL,
  number text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  refers_to uuid,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  totals jsonb NOT NULL,
  issued_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text NOT NULL,
  CONSTRAINT lr_creator_documents_creator_id_doc_type_number_version_key UNIQUE (creator_id, doc_type, number, version),
  CONSTRAINT lr_creator_documents_storage_path_key UNIQUE (storage_path),
  CONSTRAINT lr_creator_documents_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['STATEMENT'::text, 'INVOICE'::text, 'CREDIT_NOTE'::text, 'CANCELLATION'::text]))),
  CONSTRAINT lr_creator_documents_number_check CHECK ((number ~ '^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,39}$'::text)),
  CONSTRAINT lr_creator_documents_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_creator_documents_storage_path_check CHECK ((storage_path ~ '^docs/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_payout_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  holder_name text NOT NULL,
  iban_enc text NOT NULL,
  iban_last4 text NOT NULL,
  iban_country text NOT NULL,
  iban_fingerprint text NOT NULL,
  bic text,
  status text NOT NULL,
  confirmed_at timestamp with time zone NOT NULL,
  verified_at timestamp with time zone,
  verified_by text,
  superseded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_payout_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_payout_accounts_bic_check CHECK (((bic IS NULL) OR (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'::text))),
  CONSTRAINT lr_creator_payout_accounts_holder_name_check CHECK (((char_length(holder_name) >= 2) AND (char_length(holder_name) <= 140))),
  CONSTRAINT lr_creator_payout_accounts_iban_country_check CHECK ((iban_country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT lr_creator_payout_accounts_iban_enc_check CHECK ((iban_enc ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'::text)),
  CONSTRAINT lr_creator_payout_accounts_iban_fingerprint_check CHECK ((iban_fingerprint ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT lr_creator_payout_accounts_iban_last4_check CHECK ((iban_last4 ~ '^[0-9A-Z]{4}$'::text)),
  CONSTRAINT lr_creator_payout_accounts_status_check CHECK ((status = ANY (ARRAY['PROVIDED'::text, 'VERIFICATION_REQUIRED'::text, 'VERIFIED'::text, 'SUPERSEDED'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_payouts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  statement_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  amount_cents bigint NOT NULL,
  payout_account_id uuid NOT NULL,
  iban_country text NOT NULL,
  iban_last4 text NOT NULL,
  reference text NOT NULL,
  status text DEFAULT 'READY'::text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  approved_by text,
  approved_at timestamp with time zone,
  exported_at timestamp with time zone,
  export_id text,
  paid_by text,
  paid_at timestamp with time zone,
  failed_reason text,
  paid_via text,
  bank_ref text,
  returned_at timestamp with time zone,
  reissue_count integer DEFAULT 0 NOT NULL,
  CONSTRAINT lr_creator_payouts_statement_id_key UNIQUE (statement_id),
  CONSTRAINT lr_creator_payouts_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_payouts_amount_cents_check CHECK ((amount_cents > 0)),
  CONSTRAINT lr_creator_payouts_bank_ref_check CHECK (((bank_ref IS NULL) OR (char_length(bank_ref) <= 120))),
  CONSTRAINT lr_creator_payouts_failed_reason_check CHECK (((failed_reason IS NULL) OR (char_length(failed_reason) <= 300))),
  CONSTRAINT lr_creator_payouts_paid_via_check CHECK (((paid_via IS NULL) OR (paid_via = ANY (ARRAY['MANUAL'::text, 'BANK_STATEMENT'::text])))),
  CONSTRAINT lr_creator_payouts_reference_check CHECK (((char_length(reference) >= 3) AND (char_length(reference) <= 140))),
  CONSTRAINT lr_creator_payouts_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'APPROVED'::text, 'EXPORTED'::text, 'PAID'::text, 'FAILED'::text, 'RETURNED'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_refunds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversion_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  stripe_charge_id text,
  refunded_total_cents bigint NOT NULL,
  refunded_net_cents bigint NOT NULL,
  full_refund boolean DEFAULT false NOT NULL,
  processed_at timestamp with time zone,
  processed_as text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_refunds_conversion_id_refunded_total_cents_key UNIQUE (conversion_id, refunded_total_cents),
  CONSTRAINT lr_creator_refunds_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_refunds_processed_as_check CHECK (((processed_as IS NULL) OR (processed_as = ANY (ARRAY['BASE'::text, 'CLAWBACK'::text, 'REVERSED'::text, 'IGNORED'::text])))),
  CONSTRAINT lr_creator_refunds_refunded_net_cents_check CHECK ((refunded_net_cents > 0)),
  CONSTRAINT lr_creator_refunds_refunded_total_cents_check CHECK ((refunded_total_cents > 0)),
  CONSTRAINT lr_creator_refunds_stripe_charge_id_check CHECK (((stripe_charge_id IS NULL) OR (stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9_]+$'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  action text NOT NULL,
  message text,
  visible_to_creator boolean DEFAULT false NOT NULL,
  actor_ref text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_reviews_action_check CHECK ((action = ANY (ARRAY['START_REVIEW'::text, 'APPROVE'::text, 'REQUEST_INFO'::text, 'REJECT'::text, 'SUSPEND'::text, 'REACTIVATE'::text, 'NOTE'::text]))),
  CONSTRAINT lr_creator_reviews_message_check CHECK (((message IS NULL) OR (char_length(message) <= 2000)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_socials (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  platform text NOT NULL,
  platform_label text,
  channel_name text,
  handle text,
  url text NOT NULL,
  follower_range text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_creator_socials_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_socials_channel_name_check CHECK (((channel_name IS NULL) OR (char_length(channel_name) <= 100))),
  CONSTRAINT lr_creator_socials_follower_range_check CHECK (((follower_range IS NULL) OR (follower_range = ANY (ARRAY['lt_1k'::text, '1k_10k'::text, '10k_50k'::text, '50k_100k'::text, '100k_500k'::text, '500k_1m'::text, 'gt_1m'::text])))),
  CONSTRAINT lr_creator_socials_handle_check CHECK (((handle IS NULL) OR (char_length(handle) <= 100))),
  CONSTRAINT lr_creator_socials_platform_check CHECK ((platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'x'::text, 'linkedin'::text, 'other'::text]))),
  CONSTRAINT lr_creator_socials_platform_label_check CHECK (((platform_label IS NULL) OR (char_length(platform_label) <= 40))),
  CONSTRAINT lr_creator_socials_url_check CHECK (((char_length(url) <= 300) AND (url ~ '^https://'::text)))
);
CREATE TABLE IF NOT EXISTS public.lr_creator_statements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL,
  period text NOT NULL,
  status text NOT NULL,
  billing_mode text NOT NULL,
  conversions integer DEFAULT 0 NOT NULL,
  revenue_net_cents bigint DEFAULT 0 NOT NULL,
  commission_cents bigint DEFAULT 0 NOT NULL,
  adjustments_cents bigint DEFAULT 0 NOT NULL,
  net_cents bigint NOT NULL,
  vat_rate_bps integer DEFAULT 0 NOT NULL,
  vat_cents bigint DEFAULT 0 NOT NULL,
  gross_cents bigint NOT NULL,
  payout_cents bigint NOT NULL,
  tax_mode text NOT NULL,
  tax_note text NOT NULL,
  billing_snapshot jsonb NOT NULL,
  carried_over boolean DEFAULT false NOT NULL,
  closed_at timestamp with time zone DEFAULT now() NOT NULL,
  closed_by text NOT NULL,
  approved_at timestamp with time zone,
  approved_by text,
  paid_at timestamp with time zone,
  notified_at timestamp with time zone,
  reminded_at timestamp with time zone,
  CONSTRAINT lr_creator_statements_creator_id_period_key UNIQUE (creator_id, period),
  CONSTRAINT lr_creator_statements_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creator_statements_billing_mode_check CHECK ((billing_mode = ANY (ARRAY['INVOICE'::text, 'CREDIT_NOTE'::text]))),
  CONSTRAINT lr_creator_statements_payout_cents_check CHECK ((payout_cents >= 0)),
  CONSTRAINT lr_creator_statements_period_check CHECK ((period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'::text)),
  CONSTRAINT lr_creator_statements_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'INVOICED'::text, 'APPROVED'::text, 'PAID'::text, 'ZERO'::text]))),
  CONSTRAINT lr_creator_statements_tax_mode_check CHECK ((tax_mode = ANY (ARRAY['SMALL_BUSINESS'::text, 'VAT_19'::text, 'REVERSE_CHARGE'::text, 'NOT_TAXABLE_DE'::text, 'REVIEW_REQUIRED'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_creators (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  first_name text,
  last_name text,
  country text,
  phone text,
  display_name text,
  company text,
  website text,
  bio text,
  categories text[] DEFAULT '{}'::text[] NOT NULL,
  ref_code text,
  info_request text,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  billing_mode text DEFAULT 'INVOICE'::text NOT NULL,
  CONSTRAINT lr_creators_ref_code_key UNIQUE (ref_code),
  CONSTRAINT lr_creators_user_id_key UNIQUE (user_id),
  CONSTRAINT lr_creators_pkey PRIMARY KEY (id),
  CONSTRAINT lr_creators_billing_mode_check CHECK ((billing_mode = ANY (ARRAY['INVOICE'::text, 'CREDIT_NOTE'::text]))),
  CONSTRAINT lr_creators_bio_check CHECK (((bio IS NULL) OR (char_length(bio) <= 600))),
  CONSTRAINT lr_creators_categories_check CHECK ((categories <@ ARRAY['immobilien'::text, 'finanzen'::text, 'business'::text, 'entrepreneurship'::text, 'lifestyle'::text, 'technology'::text, 'education'::text, 'other'::text])),
  CONSTRAINT lr_creators_company_check CHECK (((company IS NULL) OR (char_length(company) <= 120))),
  CONSTRAINT lr_creators_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
  CONSTRAINT lr_creators_display_name_check CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 2) AND (char_length(display_name) <= 80)))),
  CONSTRAINT lr_creators_first_name_check CHECK (((first_name IS NULL) OR ((char_length(first_name) >= 1) AND (char_length(first_name) <= 80)))),
  CONSTRAINT lr_creators_info_request_check CHECK (((info_request IS NULL) OR (char_length(info_request) <= 2000))),
  CONSTRAINT lr_creators_last_name_check CHECK (((last_name IS NULL) OR ((char_length(last_name) >= 1) AND (char_length(last_name) <= 80)))),
  CONSTRAINT lr_creators_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40))),
  CONSTRAINT lr_creators_ref_code_check CHECK (((ref_code IS NULL) OR (ref_code ~ '^[a-z0-9]{10}$'::text))),
  CONSTRAINT lr_creators_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'UNDER_REVIEW'::text, 'INFO_REQUESTED'::text, 'ACTIVE'::text, 'REJECTED'::text, 'SUSPENDED'::text]))),
  CONSTRAINT lr_creators_website_check CHECK (((website IS NULL) OR ((char_length(website) <= 200) AND (website ~ '^https://'::text))))
);
CREATE TABLE IF NOT EXISTS public.lr_crm_activities (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  contact_id uuid NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  type text NOT NULL,
  campaign text,
  note text,
  actor text,
  CONSTRAINT lr_crm_activities_pkey PRIMARY KEY (id),
  CONSTRAINT lr_crm_activities_campaign_check CHECK (((campaign IS NULL) OR (char_length(campaign) <= 60))),
  CONSTRAINT lr_crm_activities_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000))),
  CONSTRAINT lr_crm_activities_type_check CHECK ((type = ANY (ARRAY['brief'::text, 'anruf'::text, 'email'::text, 'linkedin'::text, 'termin'::text, 'notiz'::text, 'status'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_crm_contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  kind text DEFAULT 'bank'::text NOT NULL,
  company text NOT NULL,
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
  source text NOT NULL,
  status text DEFAULT 'neu'::text NOT NULL,
  next_at date,
  notes text,
  objection_at timestamp with time zone,
  account_id uuid,
  CONSTRAINT lr_crm_contacts_pkey PRIMARY KEY (id),
  CONSTRAINT lr_crm_contacts_branch_check CHECK (((branch IS NULL) OR (char_length(branch) <= 120))),
  CONSTRAINT lr_crm_contacts_city_check CHECK (((city IS NULL) OR (char_length(city) <= 80))),
  CONSTRAINT lr_crm_contacts_company_check CHECK (((char_length(company) >= 2) AND (char_length(company) <= 160))),
  CONSTRAINT lr_crm_contacts_contact_name_check CHECK (((contact_name IS NULL) OR (char_length(contact_name) <= 120))),
  CONSTRAINT lr_crm_contacts_email_check CHECK (((email IS NULL) OR (char_length(email) <= 200))),
  CONSTRAINT lr_crm_contacts_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'vermittler'::text, 'makler'::text, 'finanzberater'::text, 'sonstige'::text]))),
  CONSTRAINT lr_crm_contacts_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
  CONSTRAINT lr_crm_contacts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40))),
  CONSTRAINT lr_crm_contacts_postal_code_check CHECK (((postal_code IS NULL) OR (postal_code ~ '^[0-9]{5}$'::text))),
  CONSTRAINT lr_crm_contacts_role_check CHECK (((role IS NULL) OR (char_length(role) <= 120))),
  CONSTRAINT lr_crm_contacts_salutation_check CHECK (((salutation IS NULL) OR (salutation = ANY (ARRAY['Frau'::text, 'Herr'::text, ''::text])))),
  CONSTRAINT lr_crm_contacts_source_check CHECK (((char_length(source) >= 3) AND (char_length(source) <= 300))),
  CONSTRAINT lr_crm_contacts_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'angeschrieben'::text, 'angerufen'::text, 'interesse'::text, 'termin'::text, 'kunde'::text, 'kein_interesse'::text, 'widerspruch'::text]))),
  CONSTRAINT lr_crm_contacts_street_check CHECK (((street IS NULL) OR (char_length(street) <= 160))),
  CONSTRAINT lr_crm_contacts_website_check CHECK (((website IS NULL) OR (char_length(website) <= 300)))
);
CREATE TABLE IF NOT EXISTS public.lr_data_room_access_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  share_id uuid,
  deal_id uuid,
  owner_id uuid,
  actor_type text DEFAULT 'banker'::text NOT NULL,
  action text NOT NULL,
  document_id uuid,
  ip_hash text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_data_room_access_log_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_data_room_shares (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  deal_id uuid,
  token_hash text NOT NULL,
  permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  max_views integer,
  view_count integer DEFAULT 0 NOT NULL,
  max_downloads integer,
  download_count integer DEFAULT 0 NOT NULL,
  object_ref text,
  CONSTRAINT lr_data_room_shares_token_hash_key UNIQUE (token_hash),
  CONSTRAINT lr_data_room_shares_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_deals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_deals_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_document_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_document_events_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_document_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  share_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  object_ref text NOT NULL,
  category text NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'offen'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT lr_document_requests_pkey PRIMARY KEY (id),
  CONSTRAINT lr_document_requests_category_check CHECK ((category = ANY (ARRAY['objekt'::text, 'miete'::text, 'weg'::text, 'grundbuch'::text, 'technik'::text, 'finanzen'::text, 'steuer'::text]))),
  CONSTRAINT lr_document_requests_note_check CHECK ((char_length(note) <= 300)),
  CONSTRAINT lr_document_requests_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'erledigt'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  deal_id uuid,
  filename text NOT NULL,
  mime_type text,
  storage_key text,
  sha256 text,
  classification text,
  extraction jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'uploaded'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  object_ref text,
  category text,
  size_bytes bigint,
  CONSTRAINT lr_documents_pkey PRIMARY KEY (id),
  CONSTRAINT lr_documents_category_chk CHECK (((category IS NULL) OR (category = ANY (ARRAY['objekt'::text, 'miete'::text, 'weg'::text, 'grundbuch'::text, 'technik'::text, 'finanzen'::text, 'steuer'::text]))))
);
CREATE TABLE IF NOT EXISTS public.lr_entitlements (
  user_id uuid NOT NULL,
  plan text DEFAULT 'analysis'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  trial_ends_at timestamp with time zone,
  valid_until timestamp with time zone,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_entitlements_pkey PRIMARY KEY (user_id),
  CONSTRAINT lr_entitlements_plan_check CHECK ((plan = ANY (ARRAY['analysis'::text, 'creditmap'::text, 'pro'::text]))),
  CONSTRAINT lr_entitlements_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'trial'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  area text NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  topic text NOT NULL,
  text text NOT NULL,
  importance smallint NOT NULL,
  page text,
  status text DEFAULT 'neu'::text NOT NULL,
  admin_rating smallint,
  admin_note text,
  answer text,
  CONSTRAINT lr_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT lr_feedback_admin_note_check CHECK (((admin_note IS NULL) OR (char_length(admin_note) <= 2000))),
  CONSTRAINT lr_feedback_admin_rating_check CHECK (((admin_rating >= 1) AND (admin_rating <= 5))),
  CONSTRAINT lr_feedback_answer_check CHECK (((answer IS NULL) OR (char_length(answer) <= 2000))),
  CONSTRAINT lr_feedback_area_check CHECK ((area = ANY (ARRAY['b2c'::text, 'b2b'::text]))),
  CONSTRAINT lr_feedback_importance_check CHECK (((importance >= 1) AND (importance <= 5))),
  CONSTRAINT lr_feedback_page_check CHECK (((page IS NULL) OR (char_length(page) <= 200))),
  CONSTRAINT lr_feedback_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'in_pruefung'::text, 'geplant'::text, 'umgesetzt'::text, 'abgelehnt'::text]))),
  CONSTRAINT lr_feedback_text_check CHECK (((char_length(text) >= 10) AND (char_length(text) <= 4000))),
  CONSTRAINT lr_feedback_topic_check CHECK ((topic = ANY (ARRAY['bedienung'::text, 'rechner'::text, 'kreditmappe'::text, 'inhalte'::text, 'neue_funktion'::text, 'fehler'::text, 'sonstiges'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_number text NOT NULL,
  kind text NOT NULL,
  refers_to uuid,
  source text NOT NULL,
  account_id uuid,
  buyer jsonb NOT NULL,
  items jsonb NOT NULL,
  net_cents bigint NOT NULL,
  vat_rate numeric(5,2) DEFAULT 19 NOT NULL,
  vat_cents bigint NOT NULL,
  gross_cents bigint NOT NULL,
  payment_method text NOT NULL,
  payment_status text DEFAULT 'PENDING'::text NOT NULL,
  issue_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date NOT NULL,
  service_period text,
  due_date date,
  paid_at timestamp with time zone,
  pdf_path text,
  pdf_sha256 text,
  stripe_invoice_id text,
  stripe_pdf_url text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_invoices_invoice_number_key UNIQUE (invoice_number),
  CONSTRAINT lr_invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id),
  CONSTRAINT lr_invoices_pkey PRIMARY KEY (id),
  CONSTRAINT lr_invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'storno'::text, 'credit'::text]))),
  CONSTRAINT lr_invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['STRIPE_CARD'::text, 'SEPA_B2B'::text, 'INVOICE_BANK_TRANSFER'::text]))),
  CONSTRAINT lr_invoices_payment_status_check CHECK ((payment_status = ANY (ARRAY['PAID'::text, 'PENDING'::text, 'OVERDUE'::text, 'CANCELLED'::text]))),
  CONSTRAINT lr_invoices_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'stripe'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_kaeufe (
  checkout_session_id text NOT NULL,
  email text NOT NULL,
  plan text,
  betrag integer,
  waehrung text,
  guthaben integer DEFAULT 0 NOT NULL,
  payment_intent text,
  erstattet_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_kaeufe_pkey PRIMARY KEY (checkout_session_id)
);
CREATE TABLE IF NOT EXISTS public.lr_kreditmappe_credits (
  owner_id uuid NOT NULL,
  object_ref text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_kreditmappe_credits_pkey PRIMARY KEY (owner_id, object_ref),
  CONSTRAINT lr_kreditmappe_credits_object_ref_check CHECK ((object_ref ~ '^[A-Za-z0-9_-]{4,40}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_kreditmappe_versions (
  id uuid NOT NULL,
  owner_id uuid NOT NULL,
  object_ref text NOT NULL,
  version_no integer NOT NULL,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  storage_path text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  b2b_account_id uuid,
  CONSTRAINT lr_kreditmappe_versions_owner_id_object_ref_version_no_key UNIQUE (owner_id, object_ref, version_no),
  CONSTRAINT lr_kreditmappe_versions_storage_path_key UNIQUE (storage_path),
  CONSTRAINT lr_kreditmappe_versions_pkey PRIMARY KEY (id),
  CONSTRAINT lr_kreditmappe_versions_byte_size_check CHECK ((byte_size > 0)),
  CONSTRAINT lr_kreditmappe_versions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_mail_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  direction text NOT NULL,
  folder text DEFAULT 'inbox'::text NOT NULL,
  status text,
  design text DEFAULT 'frei'::text NOT NULL,
  from_email text NOT NULL,
  from_name text,
  to_emails text[] DEFAULT '{}'::text[] NOT NULL,
  cc_emails text[] DEFAULT '{}'::text[] NOT NULL,
  subject text DEFAULT ''::text NOT NULL,
  html text,
  text_body text,
  snippet text,
  termin_fallback text,
  token text,
  with_unsub boolean DEFAULT true NOT NULL,
  message_id text,
  in_reply_to text,
  refs text,
  resend_id text,
  attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
  auth jsonb,
  contact_id uuid,
  starred boolean DEFAULT false NOT NULL,
  read_at timestamp with time zone,
  error text,
  source text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  sent_by text,
  bcc_emails text[] DEFAULT '{}'::text[] NOT NULL,
  research_url text,
  research_summary text,
  research_checked_at timestamp with time zone,
  research_flag text,
  cta jsonb,
  CONSTRAINT lr_mail_messages_resend_id_key UNIQUE (resend_id),
  CONSTRAINT lr_mail_messages_pkey PRIMARY KEY (id),
  CONSTRAINT lr_mail_messages_attachments_check CHECK ((jsonb_typeof(attachments) = 'array'::text)),
  CONSTRAINT lr_mail_messages_design_check CHECK ((design = ANY (ARRAY['frei'::text, 'fertig'::text, 'eingang'::text, 'system'::text]))),
  CONSTRAINT lr_mail_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
  CONSTRAINT lr_mail_messages_error_check CHECK (((error IS NULL) OR (char_length(error) <= 500))),
  CONSTRAINT lr_mail_messages_folder_check CHECK ((folder = ANY (ARRAY['inbox'::text, 'sent'::text, 'drafts'::text, 'archive'::text, 'spam'::text, 'trash'::text, 'belege'::text]))),
  CONSTRAINT lr_mail_messages_from_email_check CHECK ((char_length(from_email) <= 320)),
  CONSTRAINT lr_mail_messages_from_name_check CHECK (((from_name IS NULL) OR (char_length(from_name) <= 200))),
  CONSTRAINT lr_mail_messages_html_check CHECK (((html IS NULL) OR (char_length(html) <= 2000000))),
  CONSTRAINT lr_mail_messages_in_reply_to_check CHECK (((in_reply_to IS NULL) OR (char_length(in_reply_to) <= 998))),
  CONSTRAINT lr_mail_messages_message_id_check CHECK (((message_id IS NULL) OR (char_length(message_id) <= 998))),
  CONSTRAINT lr_mail_messages_refs_check CHECK (((refs IS NULL) OR (char_length(refs) <= 8000))),
  CONSTRAINT lr_mail_messages_sent_by_check CHECK (((sent_by IS NULL) OR (char_length(sent_by) <= 200))),
  CONSTRAINT lr_mail_messages_snippet_check CHECK (((snippet IS NULL) OR (char_length(snippet) <= 300))),
  CONSTRAINT lr_mail_messages_source_check CHECK (((source IS NULL) OR (char_length(source) <= 60))),
  CONSTRAINT lr_mail_messages_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['entwurf'::text, 'gesendet'::text, 'fehler'::text, 'gesperrt'::text])))),
  CONSTRAINT lr_mail_messages_subject_check CHECK ((char_length(subject) <= 500)),
  CONSTRAINT lr_mail_messages_termin_fallback_check CHECK (((termin_fallback IS NULL) OR (char_length(termin_fallback) <= 2000))),
  CONSTRAINT lr_mail_messages_text_body_check CHECK (((text_body IS NULL) OR (char_length(text_body) <= 500000)))
);
CREATE TABLE IF NOT EXISTS public.lr_newsletter (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  email text NOT NULL,
  name text,
  company text,
  segment text DEFAULT 'b2b'::text NOT NULL,
  source text,
  token_hash text NOT NULL,
  confirmed_at timestamp with time zone,
  unsubscribed_at timestamp with time zone,
  consent_text text NOT NULL,
  ip_hash text,
  CONSTRAINT lr_newsletter_email_key UNIQUE (email),
  CONSTRAINT lr_newsletter_pkey PRIMARY KEY (id),
  CONSTRAINT lr_newsletter_company_check CHECK (((company IS NULL) OR (char_length(company) <= 160))),
  CONSTRAINT lr_newsletter_email_check CHECK ((char_length(email) <= 200)),
  CONSTRAINT lr_newsletter_name_check CHECK (((name IS NULL) OR (char_length(name) <= 120))),
  CONSTRAINT lr_newsletter_segment_check CHECK ((segment = ANY (ARRAY['b2b'::text, 'b2c'::text]))),
  CONSTRAINT lr_newsletter_source_check CHECK (((source IS NULL) OR (char_length(source) <= 60)))
);
CREATE TABLE IF NOT EXISTS public.lr_newsletter_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  send_id uuid NOT NULL,
  subscriber_id uuid,
  email text NOT NULL,
  ok boolean NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_newsletter_deliveries_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_newsletter_sends (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  campaign_slug text,
  subject text NOT NULL,
  body text NOT NULL,
  segment text DEFAULT 'b2b'::text NOT NULL,
  recipients integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  actor text,
  CONSTRAINT lr_newsletter_sends_pkey PRIMARY KEY (id),
  CONSTRAINT lr_newsletter_sends_body_check CHECK ((char_length(body) <= 20000)),
  CONSTRAINT lr_newsletter_sends_subject_check CHECK ((char_length(subject) <= 160))
);
CREATE TABLE IF NOT EXISTS public.lr_outreach_links (
  token text NOT NULL,
  email text NOT NULL,
  label text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  opted_out_at timestamp with time zone,
  CONSTRAINT lr_outreach_links_pkey PRIMARY KEY (token),
  CONSTRAINT lr_outreach_links_email_check CHECK ((char_length(email) <= 200)),
  CONSTRAINT lr_outreach_links_label_check CHECK (((label IS NULL) OR (char_length(label) <= 160))),
  CONSTRAINT lr_outreach_links_token_check CHECK ((token ~ '^[A-Za-z0-9_-]{16,64}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_partners (
  slug text NOT NULL,
  name text NOT NULL,
  kind text DEFAULT 'bank'::text NOT NULL,
  active boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_partners_pkey PRIMARY KEY (slug),
  CONSTRAINT lr_partners_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'berater'::text, 'sonstige'::text]))),
  CONSTRAINT lr_partners_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 120))),
  CONSTRAINT lr_partners_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,40}$'::text))
);
CREATE TABLE IF NOT EXISTS public.lr_records (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_email text NOT NULL,
  kind text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  deleted boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_records_pkey PRIMARY KEY (id),
  CONSTRAINT lr_records_kind_check CHECK ((kind = ANY (ARRAY['objekt'::text, 'profil'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_reminder_log (
  owner_id uuid NOT NULL,
  object_ref text NOT NULL,
  kind text NOT NULL,
  due date NOT NULL,
  threshold_days integer NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_reminder_log_pkey PRIMARY KEY (owner_id, object_ref, kind, due, threshold_days)
);
CREATE TABLE IF NOT EXISTS public.lr_review_requests (
  session_id text NOT NULL,
  user_id uuid,
  area text DEFAULT 'b2c'::text NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_review_requests_pkey PRIMARY KEY (session_id),
  CONSTRAINT lr_review_requests_area_check CHECK ((area = ANY (ARRAY['b2c'::text, 'b2b'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_security_blocks (
  ip_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  until timestamp with time zone,
  reason text,
  created_by text,
  CONSTRAINT lr_security_blocks_pkey PRIMARY KEY (ip_hash),
  CONSTRAINT lr_security_blocks_ip_hash_check CHECK ((ip_hash ~ '^[0-9a-f]{32}$'::text)),
  CONSTRAINT lr_security_blocks_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 200)))
);
CREATE TABLE IF NOT EXISTS public.lr_security_log (
  id bigint DEFAULT nextval('lr_security_log_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  bucket text,
  subject text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  ip_hash text,
  detail text,
  acknowledged_at timestamp with time zone,
  CONSTRAINT lr_security_log_pkey PRIMARY KEY (id),
  CONSTRAINT lr_security_log_detail_check CHECK (((detail IS NULL) OR (char_length(detail) <= 160))),
  CONSTRAINT lr_security_log_ip_hash_check CHECK (((ip_hash IS NULL) OR (ip_hash ~ '^[0-9a-f]{32}$'::text))),
  CONSTRAINT lr_security_log_kind_check CHECK ((kind = ANY (ARRAY['rate_limit'::text, 'admin_denied'::text, 'admin_ip_blocked'::text, 'admin_mfa_missing'::text, 'panic'::text, 'honeypot'::text, 'too_fast'::text, 'disposable_email'::text, 'email_no_mx'::text, 'content_flagged'::text, 'probe'::text, 'blocked'::text, 'login_flood'::text, 'upload_rejected'::text, 'invoice_tampered'::text, 'creator_oauth_reject'::text, 'mail_abuse'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_settings (
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text,
  CONSTRAINT lr_settings_pkey PRIMARY KEY (key)
);
CREATE TABLE IF NOT EXISTS public.lr_support_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  no bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  due_at timestamp with time zone DEFAULT (now() + '12:00:00'::interval) NOT NULL,
  area text NOT NULL,
  user_id uuid NOT NULL,
  user_email text,
  account_id uuid,
  category text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  text text NOT NULL,
  expected text,
  page text,
  device jsonb DEFAULT '{}'::jsonb NOT NULL,
  shots text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'neu'::text NOT NULL,
  answer text,
  admin_note text,
  answered_at timestamp with time zone,
  resolved_at timestamp with time zone,
  CONSTRAINT lr_support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT lr_support_tickets_admin_note_check CHECK (((admin_note IS NULL) OR (char_length(admin_note) <= 2000))),
  CONSTRAINT lr_support_tickets_answer_check CHECK (((answer IS NULL) OR (char_length(answer) <= 4000))),
  CONSTRAINT lr_support_tickets_area_check CHECK ((area = ANY (ARRAY['b2c'::text, 'b2b'::text]))),
  CONSTRAINT lr_support_tickets_category_check CHECK ((category = ANY (ARRAY['anmeldung'::text, 'zahlung'::text, 'anzeige'::text, 'werkzeug'::text, 'dokument'::text, 'langsam'::text, 'sonstiges'::text]))),
  CONSTRAINT lr_support_tickets_expected_check CHECK (((expected IS NULL) OR (char_length(expected) <= 2000))),
  CONSTRAINT lr_support_tickets_page_check CHECK (((page IS NULL) OR (char_length(page) <= 300))),
  CONSTRAINT lr_support_tickets_severity_check CHECK ((severity = ANY (ARRAY['blockiert'::text, 'stoert'::text, 'klein'::text]))),
  CONSTRAINT lr_support_tickets_status_check CHECK ((status = ANY (ARRAY['neu'::text, 'in_arbeit'::text, 'rueckfrage'::text, 'geloest'::text, 'geschlossen'::text]))),
  CONSTRAINT lr_support_tickets_text_check CHECK (((char_length(text) >= 10) AND (char_length(text) <= 4000))),
  CONSTRAINT lr_support_tickets_title_check CHECK (((char_length(title) >= 3) AND (char_length(title) <= 140))),
  CONSTRAINT lr_support_tickets_user_email_check CHECK (((user_email IS NULL) OR (char_length(user_email) <= 320)))
);
CREATE TABLE IF NOT EXISTS public.lr_suppression (
  key_hash text NOT NULL,
  kind text NOT NULL,
  reason text DEFAULT 'werbewiderspruch'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_suppression_pkey PRIMARY KEY (key_hash),
  CONSTRAINT lr_suppression_kind_check CHECK ((kind = ANY (ARRAY['email'::text, 'firma'::text])))
);
CREATE TABLE IF NOT EXISTS public.lr_user_data (
  user_id uuid NOT NULL,
  email text NOT NULL,
  profile jsonb DEFAULT '{}'::jsonb NOT NULL,
  objects jsonb DEFAULT '[]'::jsonb NOT NULL,
  progress jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  last_saved_at timestamp with time zone,
  CONSTRAINT lr_user_data_pkey PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS public.lr_verify_views (
  id bigint DEFAULT nextval('lr_verify_views_id_seq'::regclass) NOT NULL,
  version_id uuid NOT NULL,
  b2b_account_id uuid,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_verify_views_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.lr_webhook_log (
  id bigint DEFAULT nextval('lr_webhook_log_id_seq'::regclass) NOT NULL,
  account_id uuid NOT NULL,
  event text NOT NULL,
  status integer,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lr_webhook_log_pkey PRIMARY KEY (id)
);
-- Number counters for invoices and creator documents (used by lr_create_invoice / lr_creator_next_number).
CREATE TABLE IF NOT EXISTS public.lr_counters (
  name text NOT NULL,
  value bigint DEFAULT 0 NOT NULL,
  CONSTRAINT lr_counters_pkey PRIMARY KEY (name)
);

ALTER SEQUENCE public.lr_admin_audit_id_seq OWNED BY public.lr_admin_audit.id;
ALTER SEQUENCE public.lr_verify_views_id_seq OWNED BY public.lr_verify_views.id;
ALTER SEQUENCE public.lr_webhook_log_id_seq OWNED BY public.lr_webhook_log.id;
ALTER SEQUENCE public.lr_security_log_id_seq OWNED BY public.lr_security_log.id;
COMMENT ON COLUMN public.lr_access_grants.features IS 'Per-feature overrides (Web-Admin B2C): {"<feature>": "on"|"off"}; missing key = according to plan.';
COMMENT ON COLUMN public.lr_b2b_accounts.avv_evidence IS 'Proof that the data processing agreement (DPA) was accepted: timestamp, version, authorized person, truncated IP, browser';
COMMENT ON COLUMN public.lr_b2b_clients.inviter_consent_at IS 'Advisor confirmed that the client has consented to the invitation (lawful basis: consent / contract)';
COMMENT ON COLUMN public.lr_mail_messages.cta IS 'Button in the email: {art: termin|kooperation|creator|zugang|unterlagen, w?, label, anrede: du|ihr|sie}. Always leads to a page (/termin or /anfrage), never to mailto.';
COMMENT ON COLUMN public.lr_mail_messages.design IS 'frei = letter from the editor, fertig = designed template, eingang = received email, system = copy of an email sent automatically by LeaseRun (account, appointment, firm …), shown unchanged.';
COMMENT ON COLUMN public.lr_mail_messages.research_flag IS 'Internal: warning, e.g. address no longer publicly findable.';
COMMENT ON COLUMN public.lr_mail_messages.research_summary IS 'Internal: short research on the recipient. Never sent.';
COMMENT ON COLUMN public.lr_mail_messages.research_url IS 'Internal: where the recipient address was found. Never sent.';
COMMENT ON TABLE public.lr_b2b_clients IS 'Client connects to a business account (with consent); the advisor sees only progress figures, never content.';
COMMENT ON TABLE public.lr_suppression IS 'Global marketing suppression list: hashes only, no plain text. Entries block any future marketing contact.';
COMMENT ON TABLE public.lr_counters IS 'Number counters for invoices and creator documents.';

-- ===================== 2_constraints_indexes.sql =====================
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_audit_events_tenant_id_fkey' AND conrelid = 'public.api_audit_events'::regclass) THEN
  ALTER TABLE public.api_audit_events ADD CONSTRAINT api_audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_cases_created_by_key_fkey' AND conrelid = 'public.api_cases'::regclass) THEN
  ALTER TABLE public.api_cases ADD CONSTRAINT api_cases_created_by_key_fkey FOREIGN KEY (created_by_key) REFERENCES api_keys(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_cases_tenant_id_fkey' AND conrelid = 'public.api_cases'::regclass) THEN
  ALTER TABLE public.api_cases ADD CONSTRAINT api_cases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_documents_case_id_fkey' AND conrelid = 'public.api_documents'::regclass) THEN
  ALTER TABLE public.api_documents ADD CONSTRAINT api_documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES api_cases(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_documents_tenant_id_fkey' AND conrelid = 'public.api_documents'::regclass) THEN
  ALTER TABLE public.api_documents ADD CONSTRAINT api_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_idempotency_keys_tenant_id_fkey' AND conrelid = 'public.api_idempotency_keys'::regclass) THEN
  ALTER TABLE public.api_idempotency_keys ADD CONSTRAINT api_idempotency_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_rotated_from_fkey' AND conrelid = 'public.api_keys'::regclass) THEN
  ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_rotated_from_fkey FOREIGN KEY (rotated_from) REFERENCES api_keys(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_tenant_id_fkey' AND conrelid = 'public.api_keys'::regclass) THEN
  ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_reports_case_id_fkey' AND conrelid = 'public.api_reports'::regclass) THEN
  ALTER TABLE public.api_reports ADD CONSTRAINT api_reports_case_id_fkey FOREIGN KEY (case_id) REFERENCES api_cases(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_reports_tenant_id_fkey' AND conrelid = 'public.api_reports'::regclass) THEN
  ALTER TABLE public.api_reports ADD CONSTRAINT api_reports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_reports_validation_id_fkey' AND conrelid = 'public.api_reports'::regclass) THEN
  ALTER TABLE public.api_reports ADD CONSTRAINT api_reports_validation_id_fkey FOREIGN KEY (validation_id) REFERENCES api_validation_runs(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_requests_key_id_fkey' AND conrelid = 'public.api_requests'::regclass) THEN
  ALTER TABLE public.api_requests ADD CONSTRAINT api_requests_key_id_fkey FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_requests_tenant_id_fkey' AND conrelid = 'public.api_requests'::regclass) THEN
  ALTER TABLE public.api_requests ADD CONSTRAINT api_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_tenant_policies_tenant_id_fkey' AND conrelid = 'public.api_tenant_policies'::regclass) THEN
  ALTER TABLE public.api_tenant_policies ADD CONSTRAINT api_tenant_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_validation_runs_case_id_fkey' AND conrelid = 'public.api_validation_runs'::regclass) THEN
  ALTER TABLE public.api_validation_runs ADD CONSTRAINT api_validation_runs_case_id_fkey FOREIGN KEY (case_id) REFERENCES api_cases(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_validation_runs_tenant_id_fkey' AND conrelid = 'public.api_validation_runs'::regclass) THEN
  ALTER TABLE public.api_validation_runs ADD CONSTRAINT api_validation_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_webhook_deliveries_endpoint_id_fkey' AND conrelid = 'public.api_webhook_deliveries'::regclass) THEN
  ALTER TABLE public.api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES api_webhook_endpoints(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_webhook_deliveries_tenant_id_fkey' AND conrelid = 'public.api_webhook_deliveries'::regclass) THEN
  ALTER TABLE public.api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_webhook_endpoints_tenant_id_fkey' AND conrelid = 'public.api_webhook_endpoints'::regclass) THEN
  ALTER TABLE public.api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_access_audit_deal_id_fkey' AND conrelid = 'public.lr_access_audit'::regclass) THEN
  ALTER TABLE public.lr_access_audit ADD CONSTRAINT lr_access_audit_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES lr_deals(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_access_audit_document_id_fkey' AND conrelid = 'public.lr_access_audit'::regclass) THEN
  ALTER TABLE public.lr_access_audit ADD CONSTRAINT lr_access_audit_document_id_fkey FOREIGN KEY (document_id) REFERENCES lr_documents(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_access_audit_owner_id_fkey' AND conrelid = 'public.lr_access_audit'::regclass) THEN
  ALTER TABLE public.lr_access_audit ADD CONSTRAINT lr_access_audit_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_access_audit_share_id_fkey' AND conrelid = 'public.lr_access_audit'::regclass) THEN
  ALTER TABLE public.lr_access_audit ADD CONSTRAINT lr_access_audit_share_id_fkey FOREIGN KEY (share_id) REFERENCES lr_data_room_shares(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_access_grants_user_id_fkey' AND conrelid = 'public.lr_access_grants'::regclass) THEN
  ALTER TABLE public.lr_access_grants ADD CONSTRAINT lr_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_accounts_owner_id_fkey' AND conrelid = 'public.lr_b2b_accounts'::regclass) THEN
  ALTER TABLE public.lr_b2b_accounts ADD CONSTRAINT lr_b2b_accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_clients_account_id_fkey' AND conrelid = 'public.lr_b2b_clients'::regclass) THEN
  ALTER TABLE public.lr_b2b_clients ADD CONSTRAINT lr_b2b_clients_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_invites_account_id_fkey' AND conrelid = 'public.lr_b2b_invites'::regclass) THEN
  ALTER TABLE public.lr_b2b_invites ADD CONSTRAINT lr_b2b_invites_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_leads_account_id_fkey' AND conrelid = 'public.lr_b2b_leads'::regclass) THEN
  ALTER TABLE public.lr_b2b_leads ADD CONSTRAINT lr_b2b_leads_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_leads_assigned_to_fkey' AND conrelid = 'public.lr_b2b_leads'::regclass) THEN
  ALTER TABLE public.lr_b2b_leads ADD CONSTRAINT lr_b2b_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_members_account_id_fkey' AND conrelid = 'public.lr_b2b_members'::regclass) THEN
  ALTER TABLE public.lr_b2b_members ADD CONSTRAINT lr_b2b_members_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_members_user_id_fkey' AND conrelid = 'public.lr_b2b_members'::regclass) THEN
  ALTER TABLE public.lr_b2b_members ADD CONSTRAINT lr_b2b_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_submissions_from_account_id_fkey' AND conrelid = 'public.lr_b2b_submissions'::regclass) THEN
  ALTER TABLE public.lr_b2b_submissions ADD CONSTRAINT lr_b2b_submissions_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_submissions_from_user_id_fkey' AND conrelid = 'public.lr_b2b_submissions'::regclass) THEN
  ALTER TABLE public.lr_b2b_submissions ADD CONSTRAINT lr_b2b_submissions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_submissions_to_account_id_fkey' AND conrelid = 'public.lr_b2b_submissions'::regclass) THEN
  ALTER TABLE public.lr_b2b_submissions ADD CONSTRAINT lr_b2b_submissions_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_submissions_version_id_fkey' AND conrelid = 'public.lr_b2b_submissions'::regclass) THEN
  ALTER TABLE public.lr_b2b_submissions ADD CONSTRAINT lr_b2b_submissions_version_id_fkey FOREIGN KEY (version_id) REFERENCES lr_kreditmappe_versions(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_usage_account_id_fkey' AND conrelid = 'public.lr_b2b_usage'::regclass) THEN
  ALTER TABLE public.lr_b2b_usage ADD CONSTRAINT lr_b2b_usage_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_b2b_verification_docs_account_id_fkey' AND conrelid = 'public.lr_b2b_verification_docs'::regclass) THEN
  ALTER TABLE public.lr_b2b_verification_docs ADD CONSTRAINT lr_b2b_verification_docs_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_packages_deal_id_fkey' AND conrelid = 'public.lr_bank_packages'::regclass) THEN
  ALTER TABLE public.lr_bank_packages ADD CONSTRAINT lr_bank_packages_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES lr_deals(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_packages_owner_id_fkey' AND conrelid = 'public.lr_bank_packages'::regclass) THEN
  ALTER TABLE public.lr_bank_packages ADD CONSTRAINT lr_bank_packages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_packages_qr_share_id_fkey' AND conrelid = 'public.lr_bank_packages'::regclass) THEN
  ALTER TABLE public.lr_bank_packages ADD CONSTRAINT lr_bank_packages_qr_share_id_fkey FOREIGN KEY (qr_share_id) REFERENCES lr_data_room_shares(id);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_pdf_audit_package_id_fkey' AND conrelid = 'public.lr_bank_pdf_audit'::regclass) THEN
  ALTER TABLE public.lr_bank_pdf_audit ADD CONSTRAINT lr_bank_pdf_audit_package_id_fkey FOREIGN KEY (package_id) REFERENCES lr_bank_packages(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_pdf_audit_pdf_version_id_fkey' AND conrelid = 'public.lr_bank_pdf_audit'::regclass) THEN
  ALTER TABLE public.lr_bank_pdf_audit ADD CONSTRAINT lr_bank_pdf_audit_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES lr_bank_pdf_versions(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_pdf_versions_package_id_fkey' AND conrelid = 'public.lr_bank_pdf_versions'::regclass) THEN
  ALTER TABLE public.lr_bank_pdf_versions ADD CONSTRAINT lr_bank_pdf_versions_package_id_fkey FOREIGN KEY (package_id) REFERENCES lr_bank_packages(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_events_actor_id_fkey' AND conrelid = 'public.lr_bank_share_events'::regclass) THEN
  ALTER TABLE public.lr_bank_share_events ADD CONSTRAINT lr_bank_share_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_events_package_id_fkey' AND conrelid = 'public.lr_bank_share_events'::regclass) THEN
  ALTER TABLE public.lr_bank_share_events ADD CONSTRAINT lr_bank_share_events_package_id_fkey FOREIGN KEY (package_id) REFERENCES lr_bank_packages(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_events_pdf_version_id_fkey' AND conrelid = 'public.lr_bank_share_events'::regclass) THEN
  ALTER TABLE public.lr_bank_share_events ADD CONSTRAINT lr_bank_share_events_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES lr_bank_pdf_versions(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_events_share_link_id_fkey' AND conrelid = 'public.lr_bank_share_events'::regclass) THEN
  ALTER TABLE public.lr_bank_share_events ADD CONSTRAINT lr_bank_share_events_share_link_id_fkey FOREIGN KEY (share_link_id) REFERENCES lr_bank_share_links(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_links_created_by_fkey' AND conrelid = 'public.lr_bank_share_links'::regclass) THEN
  ALTER TABLE public.lr_bank_share_links ADD CONSTRAINT lr_bank_share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_links_package_id_fkey' AND conrelid = 'public.lr_bank_share_links'::regclass) THEN
  ALTER TABLE public.lr_bank_share_links ADD CONSTRAINT lr_bank_share_links_package_id_fkey FOREIGN KEY (package_id) REFERENCES lr_bank_packages(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_bank_share_links_pdf_version_id_fkey' AND conrelid = 'public.lr_bank_share_links'::regclass) THEN
  ALTER TABLE public.lr_bank_share_links ADD CONSTRAINT lr_bank_share_links_pdf_version_id_fkey FOREIGN KEY (pdf_version_id) REFERENCES lr_bank_pdf_versions(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_applications_user_id_fkey' AND conrelid = 'public.lr_card_applications'::regclass) THEN
  ALTER TABLE public.lr_card_applications ADD CONSTRAINT lr_card_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_audit_card_id_fkey' AND conrelid = 'public.lr_card_audit'::regclass) THEN
  ALTER TABLE public.lr_card_audit ADD CONSTRAINT lr_card_audit_card_id_fkey FOREIGN KEY (card_id) REFERENCES lr_cards(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_limits_card_id_fkey' AND conrelid = 'public.lr_card_limits'::regclass) THEN
  ALTER TABLE public.lr_card_limits ADD CONSTRAINT lr_card_limits_card_id_fkey FOREIGN KEY (card_id) REFERENCES lr_cards(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_pricing_items_version_id_fkey' AND conrelid = 'public.lr_card_pricing_items'::regclass) THEN
  ALTER TABLE public.lr_card_pricing_items ADD CONSTRAINT lr_card_pricing_items_version_id_fkey FOREIGN KEY (version_id) REFERENCES lr_card_pricing_versions(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_transactions_card_id_fkey' AND conrelid = 'public.lr_card_transactions'::regclass) THEN
  ALTER TABLE public.lr_card_transactions ADD CONSTRAINT lr_card_transactions_card_id_fkey FOREIGN KEY (card_id) REFERENCES lr_cards(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_card_transactions_parent_id_fkey' AND conrelid = 'public.lr_card_transactions'::regclass) THEN
  ALTER TABLE public.lr_card_transactions ADD CONSTRAINT lr_card_transactions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES lr_card_transactions(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_cards_b2b_account_id_fkey' AND conrelid = 'public.lr_cards'::regclass) THEN
  ALTER TABLE public.lr_cards ADD CONSTRAINT lr_cards_b2b_account_id_fkey FOREIGN KEY (b2b_account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_cards_user_id_fkey' AND conrelid = 'public.lr_cards'::regclass) THEN
  ALTER TABLE public.lr_cards ADD CONSTRAINT lr_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_adjustments_creator_id_fkey' AND conrelid = 'public.lr_creator_adjustments'::regclass) THEN
  ALTER TABLE public.lr_creator_adjustments ADD CONSTRAINT lr_creator_adjustments_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_adjustments_statement_id_fkey' AND conrelid = 'public.lr_creator_adjustments'::regclass) THEN
  ALTER TABLE public.lr_creator_adjustments ADD CONSTRAINT lr_creator_adjustments_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES lr_creator_statements(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_agreement_acceptances_agreement_id_fkey' AND conrelid = 'public.lr_creator_agreement_acceptances'::regclass) THEN
  ALTER TABLE public.lr_creator_agreement_acceptances ADD CONSTRAINT lr_creator_agreement_acceptances_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES lr_creator_agreements(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_agreement_acceptances_creator_id_fkey' AND conrelid = 'public.lr_creator_agreement_acceptances'::regclass) THEN
  ALTER TABLE public.lr_creator_agreement_acceptances ADD CONSTRAINT lr_creator_agreement_acceptances_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_assets_campaign_id_fkey' AND conrelid = 'public.lr_creator_assets'::regclass) THEN
  ALTER TABLE public.lr_creator_assets ADD CONSTRAINT lr_creator_assets_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES lr_creator_campaigns(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_attributions_creator_id_fkey' AND conrelid = 'public.lr_creator_attributions'::regclass) THEN
  ALTER TABLE public.lr_creator_attributions ADD CONSTRAINT lr_creator_attributions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_attributions_user_id_fkey' AND conrelid = 'public.lr_creator_attributions'::regclass) THEN
  ALTER TABLE public.lr_creator_attributions ADD CONSTRAINT lr_creator_attributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_benefits_campaign_id_fkey' AND conrelid = 'public.lr_creator_benefits'::regclass) THEN
  ALTER TABLE public.lr_creator_benefits ADD CONSTRAINT lr_creator_benefits_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES lr_creator_campaigns(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_benefits_creator_id_fkey' AND conrelid = 'public.lr_creator_benefits'::regclass) THEN
  ALTER TABLE public.lr_creator_benefits ADD CONSTRAINT lr_creator_benefits_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_business_creator_id_fkey' AND conrelid = 'public.lr_creator_business'::regclass) THEN
  ALTER TABLE public.lr_creator_business ADD CONSTRAINT lr_creator_business_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_campaign_members_campaign_id_fkey' AND conrelid = 'public.lr_creator_campaign_members'::regclass) THEN
  ALTER TABLE public.lr_creator_campaign_members ADD CONSTRAINT lr_creator_campaign_members_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES lr_creator_campaigns(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_campaign_members_creator_id_fkey' AND conrelid = 'public.lr_creator_campaign_members'::regclass) THEN
  ALTER TABLE public.lr_creator_campaign_members ADD CONSTRAINT lr_creator_campaign_members_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_commission_rules_creator_id_fkey' AND conrelid = 'public.lr_creator_commission_rules'::regclass) THEN
  ALTER TABLE public.lr_creator_commission_rules ADD CONSTRAINT lr_creator_commission_rules_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_commissions_conversion_id_fkey' AND conrelid = 'public.lr_creator_commissions'::regclass) THEN
  ALTER TABLE public.lr_creator_commissions ADD CONSTRAINT lr_creator_commissions_conversion_id_fkey FOREIGN KEY (conversion_id) REFERENCES lr_creator_conversions(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_commissions_creator_id_fkey' AND conrelid = 'public.lr_creator_commissions'::regclass) THEN
  ALTER TABLE public.lr_creator_commissions ADD CONSTRAINT lr_creator_commissions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_commissions_rule_id_fkey' AND conrelid = 'public.lr_creator_commissions'::regclass) THEN
  ALTER TABLE public.lr_creator_commissions ADD CONSTRAINT lr_creator_commissions_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES lr_creator_commission_rules(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_commissions_statement_id_fkey' AND conrelid = 'public.lr_creator_commissions'::regclass) THEN
  ALTER TABLE public.lr_creator_commissions ADD CONSTRAINT lr_creator_commissions_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES lr_creator_statements(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_content_campaign_id_fkey' AND conrelid = 'public.lr_creator_content'::regclass) THEN
  ALTER TABLE public.lr_creator_content ADD CONSTRAINT lr_creator_content_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES lr_creator_campaigns(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_content_creator_id_fkey' AND conrelid = 'public.lr_creator_content'::regclass) THEN
  ALTER TABLE public.lr_creator_content ADD CONSTRAINT lr_creator_content_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_conversions_benefit_id_fkey' AND conrelid = 'public.lr_creator_conversions'::regclass) THEN
  ALTER TABLE public.lr_creator_conversions ADD CONSTRAINT lr_creator_conversions_benefit_id_fkey FOREIGN KEY (benefit_id) REFERENCES lr_creator_benefits(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_conversions_creator_id_fkey' AND conrelid = 'public.lr_creator_conversions'::regclass) THEN
  ALTER TABLE public.lr_creator_conversions ADD CONSTRAINT lr_creator_conversions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_conversions_user_id_fkey' AND conrelid = 'public.lr_creator_conversions'::regclass) THEN
  ALTER TABLE public.lr_creator_conversions ADD CONSTRAINT lr_creator_conversions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_documents_creator_id_fkey' AND conrelid = 'public.lr_creator_documents'::regclass) THEN
  ALTER TABLE public.lr_creator_documents ADD CONSTRAINT lr_creator_documents_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_documents_refers_to_fkey' AND conrelid = 'public.lr_creator_documents'::regclass) THEN
  ALTER TABLE public.lr_creator_documents ADD CONSTRAINT lr_creator_documents_refers_to_fkey FOREIGN KEY (refers_to) REFERENCES lr_creator_documents(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_documents_statement_id_fkey' AND conrelid = 'public.lr_creator_documents'::regclass) THEN
  ALTER TABLE public.lr_creator_documents ADD CONSTRAINT lr_creator_documents_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES lr_creator_statements(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_payout_accounts_creator_id_fkey' AND conrelid = 'public.lr_creator_payout_accounts'::regclass) THEN
  ALTER TABLE public.lr_creator_payout_accounts ADD CONSTRAINT lr_creator_payout_accounts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_payouts_creator_id_fkey' AND conrelid = 'public.lr_creator_payouts'::regclass) THEN
  ALTER TABLE public.lr_creator_payouts ADD CONSTRAINT lr_creator_payouts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_payouts_payout_account_id_fkey' AND conrelid = 'public.lr_creator_payouts'::regclass) THEN
  ALTER TABLE public.lr_creator_payouts ADD CONSTRAINT lr_creator_payouts_payout_account_id_fkey FOREIGN KEY (payout_account_id) REFERENCES lr_creator_payout_accounts(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_payouts_statement_id_fkey' AND conrelid = 'public.lr_creator_payouts'::regclass) THEN
  ALTER TABLE public.lr_creator_payouts ADD CONSTRAINT lr_creator_payouts_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES lr_creator_statements(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_refunds_conversion_id_fkey' AND conrelid = 'public.lr_creator_refunds'::regclass) THEN
  ALTER TABLE public.lr_creator_refunds ADD CONSTRAINT lr_creator_refunds_conversion_id_fkey FOREIGN KEY (conversion_id) REFERENCES lr_creator_conversions(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_refunds_creator_id_fkey' AND conrelid = 'public.lr_creator_refunds'::regclass) THEN
  ALTER TABLE public.lr_creator_refunds ADD CONSTRAINT lr_creator_refunds_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_reviews_creator_id_fkey' AND conrelid = 'public.lr_creator_reviews'::regclass) THEN
  ALTER TABLE public.lr_creator_reviews ADD CONSTRAINT lr_creator_reviews_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_socials_creator_id_fkey' AND conrelid = 'public.lr_creator_socials'::regclass) THEN
  ALTER TABLE public.lr_creator_socials ADD CONSTRAINT lr_creator_socials_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creator_statements_creator_id_fkey' AND conrelid = 'public.lr_creator_statements'::regclass) THEN
  ALTER TABLE public.lr_creator_statements ADD CONSTRAINT lr_creator_statements_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES lr_creators(id) ON DELETE RESTRICT;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_creators_user_id_fkey' AND conrelid = 'public.lr_creators'::regclass) THEN
  ALTER TABLE public.lr_creators ADD CONSTRAINT lr_creators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_crm_activities_contact_id_fkey' AND conrelid = 'public.lr_crm_activities'::regclass) THEN
  ALTER TABLE public.lr_crm_activities ADD CONSTRAINT lr_crm_activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES lr_crm_contacts(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_crm_contacts_account_id_fkey' AND conrelid = 'public.lr_crm_contacts'::regclass) THEN
  ALTER TABLE public.lr_crm_contacts ADD CONSTRAINT lr_crm_contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_access_log_deal_id_fkey' AND conrelid = 'public.lr_data_room_access_log'::regclass) THEN
  ALTER TABLE public.lr_data_room_access_log ADD CONSTRAINT lr_data_room_access_log_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES lr_deals(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_access_log_document_id_fkey' AND conrelid = 'public.lr_data_room_access_log'::regclass) THEN
  ALTER TABLE public.lr_data_room_access_log ADD CONSTRAINT lr_data_room_access_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES lr_documents(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_access_log_owner_id_fkey' AND conrelid = 'public.lr_data_room_access_log'::regclass) THEN
  ALTER TABLE public.lr_data_room_access_log ADD CONSTRAINT lr_data_room_access_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_access_log_share_id_fkey' AND conrelid = 'public.lr_data_room_access_log'::regclass) THEN
  ALTER TABLE public.lr_data_room_access_log ADD CONSTRAINT lr_data_room_access_log_share_id_fkey FOREIGN KEY (share_id) REFERENCES lr_data_room_shares(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_shares_deal_id_fkey' AND conrelid = 'public.lr_data_room_shares'::regclass) THEN
  ALTER TABLE public.lr_data_room_shares ADD CONSTRAINT lr_data_room_shares_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES lr_deals(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_data_room_shares_owner_id_fkey' AND conrelid = 'public.lr_data_room_shares'::regclass) THEN
  ALTER TABLE public.lr_data_room_shares ADD CONSTRAINT lr_data_room_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_deals_owner_id_fkey' AND conrelid = 'public.lr_deals'::regclass) THEN
  ALTER TABLE public.lr_deals ADD CONSTRAINT lr_deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_document_events_document_id_fkey' AND conrelid = 'public.lr_document_events'::regclass) THEN
  ALTER TABLE public.lr_document_events ADD CONSTRAINT lr_document_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES lr_documents(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_document_events_owner_id_fkey' AND conrelid = 'public.lr_document_events'::regclass) THEN
  ALTER TABLE public.lr_document_events ADD CONSTRAINT lr_document_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_document_requests_share_id_fkey' AND conrelid = 'public.lr_document_requests'::regclass) THEN
  ALTER TABLE public.lr_document_requests ADD CONSTRAINT lr_document_requests_share_id_fkey FOREIGN KEY (share_id) REFERENCES lr_data_room_shares(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_documents_deal_id_fkey' AND conrelid = 'public.lr_documents'::regclass) THEN
  ALTER TABLE public.lr_documents ADD CONSTRAINT lr_documents_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES lr_deals(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_documents_owner_id_fkey' AND conrelid = 'public.lr_documents'::regclass) THEN
  ALTER TABLE public.lr_documents ADD CONSTRAINT lr_documents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_entitlements_user_id_fkey' AND conrelid = 'public.lr_entitlements'::regclass) THEN
  ALTER TABLE public.lr_entitlements ADD CONSTRAINT lr_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_feedback_account_id_fkey' AND conrelid = 'public.lr_feedback'::regclass) THEN
  ALTER TABLE public.lr_feedback ADD CONSTRAINT lr_feedback_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_invoices_account_id_fkey' AND conrelid = 'public.lr_invoices'::regclass) THEN
  ALTER TABLE public.lr_invoices ADD CONSTRAINT lr_invoices_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_invoices_refers_to_fkey' AND conrelid = 'public.lr_invoices'::regclass) THEN
  ALTER TABLE public.lr_invoices ADD CONSTRAINT lr_invoices_refers_to_fkey FOREIGN KEY (refers_to) REFERENCES lr_invoices(id);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_kreditmappe_versions_b2b_account_id_fkey' AND conrelid = 'public.lr_kreditmappe_versions'::regclass) THEN
  ALTER TABLE public.lr_kreditmappe_versions ADD CONSTRAINT lr_kreditmappe_versions_b2b_account_id_fkey FOREIGN KEY (b2b_account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_kreditmappe_versions_owner_id_fkey' AND conrelid = 'public.lr_kreditmappe_versions'::regclass) THEN
  ALTER TABLE public.lr_kreditmappe_versions ADD CONSTRAINT lr_kreditmappe_versions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_mail_messages_contact_id_fkey' AND conrelid = 'public.lr_mail_messages'::regclass) THEN
  ALTER TABLE public.lr_mail_messages ADD CONSTRAINT lr_mail_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES lr_crm_contacts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_mail_messages_token_fkey' AND conrelid = 'public.lr_mail_messages'::regclass) THEN
  ALTER TABLE public.lr_mail_messages ADD CONSTRAINT lr_mail_messages_token_fkey FOREIGN KEY (token) REFERENCES lr_outreach_links(token) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_newsletter_deliveries_send_id_fkey' AND conrelid = 'public.lr_newsletter_deliveries'::regclass) THEN
  ALTER TABLE public.lr_newsletter_deliveries ADD CONSTRAINT lr_newsletter_deliveries_send_id_fkey FOREIGN KEY (send_id) REFERENCES lr_newsletter_sends(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_newsletter_deliveries_subscriber_id_fkey' AND conrelid = 'public.lr_newsletter_deliveries'::regclass) THEN
  ALTER TABLE public.lr_newsletter_deliveries ADD CONSTRAINT lr_newsletter_deliveries_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES lr_newsletter(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_reminder_log_owner_id_fkey' AND conrelid = 'public.lr_reminder_log'::regclass) THEN
  ALTER TABLE public.lr_reminder_log ADD CONSTRAINT lr_reminder_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_support_tickets_account_id_fkey' AND conrelid = 'public.lr_support_tickets'::regclass) THEN
  ALTER TABLE public.lr_support_tickets ADD CONSTRAINT lr_support_tickets_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_user_data_user_id_fkey' AND conrelid = 'public.lr_user_data'::regclass) THEN
  ALTER TABLE public.lr_user_data ADD CONSTRAINT lr_user_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_verify_views_b2b_account_id_fkey' AND conrelid = 'public.lr_verify_views'::regclass) THEN
  ALTER TABLE public.lr_verify_views ADD CONSTRAINT lr_verify_views_b2b_account_id_fkey FOREIGN KEY (b2b_account_id) REFERENCES lr_b2b_accounts(id) ON DELETE SET NULL;
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_webhook_log_account_id_fkey' AND conrelid = 'public.lr_webhook_log'::regclass) THEN
  ALTER TABLE public.lr_webhook_log ADD CONSTRAINT lr_webhook_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES lr_b2b_accounts(id) ON DELETE CASCADE;
END IF; END $do$;
CREATE INDEX IF NOT EXISTS api_audit_tenant_idx ON public.api_audit_events USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_cases_created_by_key_fk_idx ON public.api_cases USING btree (created_by_key);
CREATE UNIQUE INDEX IF NOT EXISTS api_cases_extref_uidx ON public.api_cases USING btree (tenant_id, environment, external_reference) WHERE ((external_reference IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS api_cases_tenant_idx ON public.api_cases USING btree (tenant_id, environment, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS api_deliveries_due_idx ON public.api_webhook_deliveries USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'retrying'::text]));
CREATE INDEX IF NOT EXISTS api_deliveries_tenant_idx ON public.api_webhook_deliveries USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_documents_case_id_fk_idx ON public.api_documents USING btree (case_id);
CREATE INDEX IF NOT EXISTS api_documents_case_idx ON public.api_documents USING btree (tenant_id, case_id, uploaded_at DESC, id DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS api_idem_time_idx ON public.api_idempotency_keys USING btree (created_at);
CREATE INDEX IF NOT EXISTS api_keys_rotated_from_fk_idx ON public.api_keys USING btree (rotated_from);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON public.api_keys USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_reports_case_id_fk_idx ON public.api_reports USING btree (case_id);
CREATE INDEX IF NOT EXISTS api_reports_case_idx ON public.api_reports USING btree (tenant_id, case_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS api_reports_queue_idx ON public.api_reports USING btree (status, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));
CREATE INDEX IF NOT EXISTS api_reports_validation_id_fk_idx ON public.api_reports USING btree (validation_id);
CREATE INDEX IF NOT EXISTS api_requests_key_idx ON public.api_requests USING btree (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_requests_tenant_idx ON public.api_requests USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_requests_time_idx ON public.api_requests USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS api_validation_case_idx ON public.api_validation_runs USING btree (tenant_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_validation_runs_case_id_fk_idx ON public.api_validation_runs USING btree (case_id);
CREATE INDEX IF NOT EXISTS api_webhooks_tenant_idx ON public.api_webhook_endpoints USING btree (tenant_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON public.lr_admin_audit USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2bleads_account_date ON public.lr_b2b_leads USING btree (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2bleads_assigned ON public.lr_b2b_leads USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bank_pdf_audit_version_created ON public.lr_bank_pdf_audit USING btree (pdf_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_pdf_versions_package_created ON public.lr_bank_pdf_versions USING btree (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_share_events_link_created ON public.lr_bank_share_events USING btree (share_link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_share_links_token_expires ON public.lr_bank_share_links USING btree (token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_lr_bank_packages_deal ON public.lr_bank_packages USING btree (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lr_document_events_doc ON public.lr_document_events USING btree (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lr_room_access_share ON public.lr_data_room_access_log USING btree (share_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_account ON public.lr_invoices USING btree (account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_paid ON public.lr_invoices USING btree (paid_at);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON public.lr_invoices USING btree (issue_date, account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_refers ON public.lr_invoices USING btree (refers_to);
CREATE INDEX IF NOT EXISTS idx_kmv_b2b_time ON public.lr_kreditmappe_versions USING btree (b2b_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_from ON public.lr_b2b_submissions USING btree (from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_from_user ON public.lr_b2b_submissions USING btree (from_user_id);
CREATE INDEX IF NOT EXISTS idx_sub_to ON public.lr_b2b_submissions USING btree (to_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_version ON public.lr_b2b_submissions USING btree (version_id);
CREATE INDEX IF NOT EXISTS idx_verify_views_acc ON public.lr_verify_views USING btree (b2b_account_id);
CREATE INDEX IF NOT EXISTS idx_verify_views_time ON public.lr_verify_views USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whlog_acc ON public.lr_webhook_log USING btree (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_access_audit_deal_id_idx ON public.lr_access_audit USING btree (deal_id);
CREATE INDEX IF NOT EXISTS lr_access_audit_document_id_idx ON public.lr_access_audit USING btree (document_id);
CREATE INDEX IF NOT EXISTS lr_access_audit_owner_id_idx ON public.lr_access_audit USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_access_audit_share_id_idx ON public.lr_access_audit USING btree (share_id);
CREATE INDEX IF NOT EXISTS lr_admin_push_tokens_email ON public.lr_admin_push_tokens USING btree (email);
CREATE INDEX IF NOT EXISTS lr_admin_push_tokens_user ON public.lr_admin_push_tokens USING btree (user_id);
CREATE INDEX IF NOT EXISTS lr_analytics_seg_ev_ts ON public.lr_analytics USING btree (seg, ev, ts);
CREATE INDEX IF NOT EXISTS lr_analytics_ts ON public.lr_analytics USING btree (ts);
CREATE INDEX IF NOT EXISTS lr_audit_created_idx ON public.lr_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS lr_b2b_clients_account_idx ON public.lr_b2b_clients USING btree (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_b2b_clients_unique_active ON public.lr_b2b_clients USING btree (account_id, client_user_id) WHERE (status = 'verbunden'::text);
CREATE INDEX IF NOT EXISTS lr_b2b_clients_user_idx ON public.lr_b2b_clients USING btree (client_user_id);
CREATE INDEX IF NOT EXISTS lr_b2b_invites_account ON public.lr_b2b_invites USING btree (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_b2b_members_user ON public.lr_b2b_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS lr_b2b_verification_docs_account_idx ON public.lr_b2b_verification_docs USING btree (account_id);
CREATE INDEX IF NOT EXISTS lr_bank_packages_deal_id_idx ON public.lr_bank_packages USING btree (deal_id);
CREATE INDEX IF NOT EXISTS lr_bank_packages_owner_id_idx ON public.lr_bank_packages USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_bank_packages_qr_share_id_idx ON public.lr_bank_packages USING btree (qr_share_id);
CREATE INDEX IF NOT EXISTS lr_bank_pdf_audit_package_id_idx ON public.lr_bank_pdf_audit USING btree (package_id);
CREATE INDEX IF NOT EXISTS lr_bank_pdf_audit_pdf_version_id_idx ON public.lr_bank_pdf_audit USING btree (pdf_version_id);
CREATE INDEX IF NOT EXISTS lr_bank_pdf_versions_package_id_idx ON public.lr_bank_pdf_versions USING btree (package_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_events_actor_id_idx ON public.lr_bank_share_events USING btree (actor_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_events_package_id_idx ON public.lr_bank_share_events USING btree (package_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_events_pdf_version_id_idx ON public.lr_bank_share_events USING btree (pdf_version_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_events_share_link_id_idx ON public.lr_bank_share_events USING btree (share_link_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_links_created_by_idx ON public.lr_bank_share_links USING btree (created_by);
CREATE INDEX IF NOT EXISTS lr_bank_share_links_package_id_idx ON public.lr_bank_share_links USING btree (package_id);
CREATE INDEX IF NOT EXISTS lr_bank_share_links_pdf_version_id_idx ON public.lr_bank_share_links USING btree (pdf_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_bookings_active_slot ON public.lr_bookings USING btree (starts_at) WHERE (status = ANY (ARRAY['angefragt'::text, 'bestaetigt'::text]));
CREATE INDEX IF NOT EXISTS lr_bookings_time ON public.lr_bookings USING btree (starts_at) WHERE (status = ANY (ARRAY['angefragt'::text, 'bestaetigt'::text]));
CREATE INDEX IF NOT EXISTS lr_card_applications_user ON public.lr_card_applications USING btree (user_id);
CREATE INDEX IF NOT EXISTS lr_card_audit_card ON public.lr_card_audit USING btree (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_card_pricing_items_version ON public.lr_card_pricing_items USING btree (version_id, chapter, "position");
CREATE INDEX IF NOT EXISTS lr_card_transactions_parent_id_fk_idx ON public.lr_card_transactions USING btree (parent_id);
CREATE INDEX IF NOT EXISTS lr_card_tx_card_created ON public.lr_card_transactions USING btree (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_cards_b2b ON public.lr_cards USING btree (b2b_account_id) WHERE (b2b_account_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS lr_cards_user ON public.lr_cards USING btree (user_id);
CREATE INDEX IF NOT EXISTS lr_client_errors_last_idx ON public.lr_client_errors USING btree (last_seen DESC);
CREATE INDEX IF NOT EXISTS lr_creator_adjustments_open_idx ON public.lr_creator_adjustments USING btree (creator_id, period) WHERE (statement_id IS NULL);
CREATE INDEX IF NOT EXISTS lr_creator_adjustments_statement_id_fk_idx ON public.lr_creator_adjustments USING btree (statement_id);
CREATE INDEX IF NOT EXISTS lr_creator_agreement_acceptances_agreement_id_fk_idx ON public.lr_creator_agreement_acceptances USING btree (agreement_id);
CREATE INDEX IF NOT EXISTS lr_creator_assets_campaign_idx ON public.lr_creator_assets USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS lr_creator_attributions_creator_idx ON public.lr_creator_attributions USING btree (creator_id, created_at);
CREATE INDEX IF NOT EXISTS lr_creator_audit_creator_idx ON public.lr_creator_audit USING btree (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_creator_audit_type_idx ON public.lr_creator_audit USING btree (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_creator_benefits_campaign_id_fk_idx ON public.lr_creator_benefits USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS lr_creator_benefits_creator_idx ON public.lr_creator_benefits USING btree (creator_id);
CREATE INDEX IF NOT EXISTS lr_creator_campaign_members_creator_idx ON public.lr_creator_campaign_members USING btree (creator_id);
CREATE INDEX IF NOT EXISTS lr_creator_commissions_creator_idx ON public.lr_creator_commissions USING btree (creator_id, period);
CREATE INDEX IF NOT EXISTS lr_creator_commissions_rule_id_fk_idx ON public.lr_creator_commissions USING btree (rule_id);
CREATE INDEX IF NOT EXISTS lr_creator_commissions_statement_id_fk_idx ON public.lr_creator_commissions USING btree (statement_id);
CREATE INDEX IF NOT EXISTS lr_creator_content_campaign_id_fk_idx ON public.lr_creator_content USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS lr_creator_content_status_idx ON public.lr_creator_content USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_creator_conversions_benefit_id_fk_idx ON public.lr_creator_conversions USING btree (benefit_id);
CREATE INDEX IF NOT EXISTS lr_creator_conversions_creator_idx ON public.lr_creator_conversions USING btree (creator_id, occurred_at);
CREATE INDEX IF NOT EXISTS lr_creator_conversions_pi_idx ON public.lr_creator_conversions USING btree (stripe_payment_intent);
CREATE INDEX IF NOT EXISTS lr_creator_conversions_user_id_fk_idx ON public.lr_creator_conversions USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_creator_documents_one_valid ON public.lr_creator_documents USING btree (statement_id, doc_type) WHERE ((doc_type = ANY (ARRAY['INVOICE'::text, 'CREDIT_NOTE'::text])) AND (refers_to IS NULL) AND (version = 1));
CREATE INDEX IF NOT EXISTS lr_creator_documents_refers_to_fk_idx ON public.lr_creator_documents USING btree (refers_to);
CREATE INDEX IF NOT EXISTS lr_creator_documents_statement_idx ON public.lr_creator_documents USING btree (statement_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_creator_payout_current_uq ON public.lr_creator_payout_accounts USING btree (creator_id) WHERE (status <> 'SUPERSEDED'::text);
CREATE INDEX IF NOT EXISTS lr_creator_payouts_creator_id_fk_idx ON public.lr_creator_payouts USING btree (creator_id);
CREATE INDEX IF NOT EXISTS lr_creator_payouts_payout_account_id_fk_idx ON public.lr_creator_payouts USING btree (payout_account_id);
CREATE INDEX IF NOT EXISTS lr_creator_payouts_status_idx ON public.lr_creator_payouts USING btree (status, created_at);
CREATE INDEX IF NOT EXISTS lr_creator_refunds_creator_id_fk_idx ON public.lr_creator_refunds USING btree (creator_id);
CREATE INDEX IF NOT EXISTS lr_creator_refunds_open_idx ON public.lr_creator_refunds USING btree (conversion_id) WHERE (processed_at IS NULL);
CREATE INDEX IF NOT EXISTS lr_creator_reviews_creator_idx ON public.lr_creator_reviews USING btree (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_creator_rules_scope_idx ON public.lr_creator_commission_rules USING btree (creator_id, campaign_slug, valid_from);
CREATE INDEX IF NOT EXISTS lr_creator_socials_creator_idx ON public.lr_creator_socials USING btree (creator_id);
CREATE INDEX IF NOT EXISTS lr_creator_statements_period_idx ON public.lr_creator_statements USING btree (period, status);
CREATE INDEX IF NOT EXISTS lr_creators_status_idx ON public.lr_creators USING btree (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS lr_crm_activities_contact ON public.lr_crm_activities USING btree (contact_id, at DESC);
CREATE INDEX IF NOT EXISTS lr_crm_contacts_account_idx ON public.lr_crm_contacts USING btree (account_id);
CREATE INDEX IF NOT EXISTS lr_crm_contacts_status ON public.lr_crm_contacts USING btree (status, next_at);
CREATE INDEX IF NOT EXISTS lr_data_room_access_log_deal_id_idx ON public.lr_data_room_access_log USING btree (deal_id);
CREATE INDEX IF NOT EXISTS lr_data_room_access_log_document_id_idx ON public.lr_data_room_access_log USING btree (document_id);
CREATE INDEX IF NOT EXISTS lr_data_room_access_log_owner_id_idx ON public.lr_data_room_access_log USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_data_room_access_log_share_id_idx ON public.lr_data_room_access_log USING btree (share_id);
CREATE INDEX IF NOT EXISTS lr_data_room_shares_deal_id_idx ON public.lr_data_room_shares USING btree (deal_id);
CREATE INDEX IF NOT EXISTS lr_data_room_shares_owner_id_idx ON public.lr_data_room_shares USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_deals_owner_id_idx ON public.lr_deals USING btree (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_doc_requests_open_once ON public.lr_document_requests USING btree (share_id, category) WHERE (status = 'offen'::text);
CREATE INDEX IF NOT EXISTS lr_doc_requests_owner_idx ON public.lr_document_requests USING btree (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_document_events_document_id_idx ON public.lr_document_events USING btree (document_id);
CREATE INDEX IF NOT EXISTS lr_document_events_owner_id_idx ON public.lr_document_events USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_documents_deal_id_idx ON public.lr_documents USING btree (deal_id);
CREATE INDEX IF NOT EXISTS lr_documents_owner_id_idx ON public.lr_documents USING btree (owner_id);
CREATE INDEX IF NOT EXISTS lr_documents_owner_object_idx ON public.lr_documents USING btree (owner_id, object_ref);
CREATE INDEX IF NOT EXISTS lr_feedback_account_id_idx ON public.lr_feedback USING btree (account_id);
CREATE INDEX IF NOT EXISTS lr_feedback_area_created ON public.lr_feedback USING btree (area, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_feedback_user ON public.lr_feedback USING btree (user_id);
CREATE INDEX IF NOT EXISTS lr_kaeufe_pi_idx ON public.lr_kaeufe USING btree (payment_intent);
CREATE INDEX IF NOT EXISTS lr_km_versions_owner_idx ON public.lr_kreditmappe_versions USING btree (owner_id, object_ref, version_no DESC);
CREATE INDEX IF NOT EXISTS lr_mail_contact_idx ON public.lr_mail_messages USING btree (contact_id);
CREATE INDEX IF NOT EXISTS lr_mail_folder_idx ON public.lr_mail_messages USING btree (folder, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_mail_messages_token_fk_idx ON public.lr_mail_messages USING btree (token);
CREATE INDEX IF NOT EXISTS lr_mail_msgid_idx ON public.lr_mail_messages USING btree (message_id);
CREATE INDEX IF NOT EXISTS lr_mail_thread_idx ON public.lr_mail_messages USING btree (thread_id, created_at);
CREATE INDEX IF NOT EXISTS lr_newsletter_deliveries_send_idx ON public.lr_newsletter_deliveries USING btree (send_id);
CREATE INDEX IF NOT EXISTS lr_newsletter_deliveries_subscriber_idx ON public.lr_newsletter_deliveries USING btree (subscriber_id);
CREATE INDEX IF NOT EXISTS lr_records_owner_idx ON public.lr_records USING btree (owner_email, kind, deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS lr_security_log_created ON public.lr_security_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS lr_shares_owner_idx ON public.lr_data_room_shares USING btree (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_support_tickets_account_id_fk_idx ON public.lr_support_tickets USING btree (account_id);
CREATE INDEX IF NOT EXISTS lr_support_tickets_area_created ON public.lr_support_tickets USING btree (area, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_support_tickets_open ON public.lr_support_tickets USING btree (status) WHERE (status = ANY (ARRAY['neu'::text, 'in_arbeit'::text, 'rueckfrage'::text]));
CREATE INDEX IF NOT EXISTS lr_support_tickets_user ON public.lr_support_tickets USING btree (user_id, created_at DESC);

-- ===================== 3_functions.sql =====================
CREATE OR REPLACE FUNCTION public.admin_analytics(seg_in text, days integer DEFAULT 30, admins text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with a as (select * from public.lr_analytics where seg = seg_in and ts > now() - make_interval(days => days)),
  pv as (select * from a where ev = 'pv'),
  prev as (select * from public.lr_analytics where seg = seg_in and ev = 'pv' and ts <= now() - make_interval(days => days) and ts > now() - make_interval(days => days * 2)),
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
    'refs', (select coalesce(jsonb_agg(jsonb_build_array(r, n)), '[]'::jsonb) from (select coalesce(src, ref, 'Direct / unknown') r, count(distinct visitor) n from pv group by 1 order by 2 desc limit 12) x),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_array(c, n)), '[]'::jsonb) from (select concat_ws(' / ', src, med, camp) c, count(distinct visitor) n from pv where camp is not null or med is not null group by 1 order by 2 desc limit 10) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_array(device, n)), '[]'::jsonb) from (select coalesce(device,'?') device, count(distinct visitor) n from pv group by 1 order by 2 desc) x),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_array(browser, n)), '[]'::jsonb) from (select coalesce(browser,'Other') browser, count(distinct visitor) n from pv group by 1 order by 2 desc limit 8) x),
    'os', (select coalesce(jsonb_agg(jsonb_build_array(os, n)), '[]'::jsonb) from (select coalesce(os,'Other') os, count(distinct visitor) n from pv group by 1 order by 2 desc limit 8) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_array(country, n)), '[]'::jsonb) from (select coalesce(country,'??') country, count(distinct visitor) n from pv group by 1 order by 2 desc limit 10) x),
    'events', (select coalesce(jsonb_object_agg(ev, n), '{}'::jsonb) from (select ev, count(*) n from a where ev <> 'pv' group by ev) x),
    'eventVisitors', (select coalesce(jsonb_object_agg(ev, n), '{}'::jsonb) from (select ev, count(distinct visitor) n from a where ev <> 'pv' and visitor is not null group by ev) x),
    'offerVisitors', (select count(distinct visitor) from pv where path in ('/angebote','/b2b') or path like '/angebote/%'),
    'registrations', (select n from regs),
    'purchases', (select count(*) from a where ev = 'purchase'),
    'revenueCents', null
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_analytics(seg_in text, days integer, admins text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics(seg_in text, days integer, admins text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_analytics_geo(seg_in text, days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pv as (select * from public.lr_analytics where seg = seg_in and ev = 'pv' and ts > now() - make_interval(days => days))
  select jsonb_build_object(
    'cities', (select coalesce(jsonb_agg(jsonb_build_array(c, r, k, n)), '[]'::jsonb) from (select city c, region r, country k, count(distinct visitor) n from pv where city is not null group by 1,2,3 order by 4 desc limit 25) x),
    'regions', (select coalesce(jsonb_agg(jsonb_build_array(r, k, n)), '[]'::jsonb) from (select region r, country k, count(distinct visitor) n from pv where region is not null group by 1,2 order by 3 desc limit 20) x)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_analytics_geo(seg_in text, days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics_geo(seg_in text, days integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_campaign_stats(days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_object_agg(camp, jsonb_build_object('visitors', v, 'pageviews', p, 'requests', r, 'registrations', g)), '{}'::jsonb) from (
    select camp, count(distinct visitor) filter (where ev = 'pv') v, count(*) filter (where ev = 'pv') p,
      count(*) filter (where ev in ('b2b_request','b2b_contact')) r, count(*) filter (where ev = 'register') g
    from public.lr_analytics where camp is not null and ts > now() - make_interval(days => days) group by camp) x;
$function$;

REVOKE ALL ON FUNCTION public.admin_campaign_stats(days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_campaign_stats(days integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_funnel(seg text, admins text[] DEFAULT '{}'::text[], days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b2b_users as (select distinct user_id from public.lr_b2b_members),
  u as (
    select au.id, au.created_at, au.email_confirmed_at from auth.users au
    where lower(coalesce(au.email, '')) <> all (select lower(x) from unnest(admins) x)
      and au.id not in (select user_id from b2b_users)
      and (days is null or au.created_at > now() - make_interval(days => days))
  ),
  d as (
    select u.*, ud.profile, ud.objects, ud.progress from u left join public.lr_user_data ud on ud.user_id = u.id
  ),
  acc as (
    select a.* from public.lr_b2b_accounts a where days is null or a.created_at > now() - make_interval(days => days)
  )
  select case when seg = 'b2b' then jsonb_build_object('seg', 'b2b', 'steps', jsonb_build_array(
      jsonb_build_array('Company registered', (select count(*) from acc)),
      jsonb_build_array('Documents submitted', (select count(*) from acc where verification_status in ('eingereicht', 'geprueft') or verified_at is not null)),
      jsonb_build_array('Verified', (select count(*) from acc where verified_at is not null)),
      jsonb_build_array('Plan purchased', (select count(*) from acc where plan_tier is not null and (plan_until is null or plan_until > now()))),
      jsonb_build_array('First request received', (select count(distinct l.account_id) from public.lr_b2b_leads l where l.account_id in (select id from acc))),
      jsonb_build_array('Client connected', (select count(distinct c.account_id) from public.lr_b2b_clients c where c.status = 'verbunden' and c.account_id in (select id from acc)))
    ))
  else jsonb_build_object('seg', 'b2c', 'steps', jsonb_build_array(
      jsonb_build_array('Registered', (select count(*) from d)),
      jsonb_build_array('Email confirmed', (select count(*) from d where email_confirmed_at is not null)),
      jsonb_build_array('Set up (wizard or mode)', (select count(*) from d where profile ? 'onboardedAt' or profile ? 'mode')),
      jsonb_build_array('Financial profile completed', (select count(*) from d where coalesce(profile->>'netIncome', '') ~ '^[0-9]+(\.[0-9]+)?$' and (profile->>'netIncome')::numeric > 0)),
      jsonb_build_array('Property created', (select count(*) from d where jsonb_typeof(objects) = 'array' and jsonb_array_length(objects) > 0)),
      jsonb_build_array('Bank readiness ≥ 90 %', (select count(*) from d where coalesce(progress->'summary'->>'best', '') ~ '^[0-9]+$' and (progress->'summary'->>'best')::int >= 90)),
      jsonb_build_array('Plan purchased', (select count(*) from d where exists (select 1 from public.lr_entitlements e where e.user_id = d.id and e.status in ('active', 'trialing'))))
    ))
  end;
$function$;

REVOKE ALL ON FUNCTION public.admin_funnel(seg text, admins text[], days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_funnel(seg text, admins text[], days integer) TO service_role;

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
    'blocked7d', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.lr_security_log where created_at > now() - interval '7 days' group by kind) k), '{}'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_security_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_security_overview() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_segment_overview(seg text, admins text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b2b_users as (select distinct user_id from public.lr_b2b_members),
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
    'kreditmappen30d', (select count(*) from public.lr_kreditmappe_versions k where k.owner_id in (select id from ids) and k.created_at > now() - interval '30 days'),
    'documents', (select count(*) from public.lr_documents d where d.owner_id in (select id from ids)),
    'b2c', case when seg = 'b2c' then jsonb_build_object(
      'paying', (select count(*) from public.lr_entitlements e where e.user_id in (select id from ids) and e.status in ('active', 'trialing') and (e.valid_until is null or e.valid_until > now())),
      'objects', (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(ud.objects) = 'array' then ud.objects else '[]'::jsonb end)), 0) from public.lr_user_data ud where ud.user_id in (select id from ids)),
      'purchases30d', (select count(*) from public.lr_kaeufe k where k.created_at > now() - interval '30 days' and k.erstattet_at is null),
      'purchasesCents30d', (select coalesce(sum(k.betrag), 0) from public.lr_kaeufe k where k.created_at > now() - interval '30 days' and k.erstattet_at is null),
      'revenueMonthCents', (select coalesce(sum(i.gross_cents), 0) from public.lr_invoices i, m0 where i.account_id is null and i.issue_date >= m0.s and i.payment_status = 'PAID'),
      'openInvoices', (select count(*) from public.lr_invoices i where i.account_id is null and i.payment_status in ('PENDING', 'OVERDUE'))
    ) else null end,
    'b2b', case when seg = 'b2b' then jsonb_build_object(
      'companies', (select count(*) from public.lr_b2b_accounts),
      'verified', (select count(*) from public.lr_b2b_accounts where verified_at is not null),
      'reviewPending', (select count(*) from public.lr_b2b_accounts where verification_status = 'eingereicht'),
      'locked', (select count(*) from public.lr_b2b_accounts where status is not null and status not in ('active', 'aktiv')),
      'paidPlans', (select count(*) from public.lr_b2b_accounts where plan_tier is not null and plan_tier <> 'FREE' and (plan_until is null or plan_until > now())),
      'leads30d', (select count(*) from public.lr_b2b_leads where created_at > now() - interval '30 days'),
      'leadsNew', (select count(*) from public.lr_b2b_leads where status = 'neu'),
      'submissions30d', (select count(*) from public.lr_b2b_submissions where created_at > now() - interval '30 days'),
      'contactOpen', (select count(*) from public.lr_b2b_contact where status = 'offen'),
      'revenueMonthCents', (select coalesce(sum(i.gross_cents), 0) from public.lr_invoices i, m0 where i.account_id is not null and i.issue_date >= m0.s and i.payment_status = 'PAID'),
      'openInvoices', (select count(*) from public.lr_invoices i where i.account_id is not null and i.payment_status in ('PENDING', 'OVERDUE')),
      'openCents', (select coalesce(sum(i.gross_cents), 0) from public.lr_invoices i where i.account_id is not null and i.payment_status in ('PENDING', 'OVERDUE'))
    ) else null end
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_segment_overview(seg text, admins text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_segment_overview(seg text, admins text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.api_audit_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare prev text;
begin
  perform pg_advisory_xact_lock(hashtext('api_audit_chain'));
  select hash into prev from public.api_audit_events order by id desc limit 1;
  new.created_at := now();
  new.prev_hash := prev;
  new.hash := encode(extensions.digest(coalesce(prev, '') || '|' || coalesce(new.tenant_id::text, '') || '|' || coalesce(new.environment, '') || '|' ||
    new.actor || '|' || new.action || '|' || coalesce(new.resource_type, '') || '|' || coalesce(new.resource_id, '') || '|' ||
    coalesce(new.request_id, '') || '|' || new.result || '|' || new.meta::text || '|' || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.api_audit_chain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_audit_chain() TO service_role;

CREATE OR REPLACE FUNCTION public.api_audit_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and new.tenant_id is null and old.tenant_id is not null
     and (new.action, new.hash, new.actor, new.created_at) is not distinct from (old.action, old.hash, old.actor, old.created_at) then
    return new;
  end if;
  raise exception 'api_audit_events is immutable';
end $function$;

REVOKE ALL ON FUNCTION public.api_audit_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_audit_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.api_rate_take(p_bucket text, p_window_seconds integer, p_limit integer)
 RETURNS TABLE(used integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
begin
  insert into public.api_rate_counters as c (bucket, window_start, n) values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set n = c.n + 1
  returning c.n into used;
  reset_at := ws + make_interval(secs => p_window_seconds);
  return next;
end $function$;

REVOKE ALL ON FUNCTION public.api_rate_take(p_bucket text, p_window_seconds integer, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_rate_take(p_bucket text, p_window_seconds integer, p_limit integer) TO service_role;

CREATE OR REPLACE FUNCTION public.api_usage_series(p_tenant uuid, p_env text, p_from timestamp with time zone, p_bucket text)
 RETURNS TABLE(bucket timestamp with time zone, requests bigint, errors_4xx bigint, errors_5xx bigint, rate_limited bigint, avg_ms numeric, p95_ms numeric, p99_ms numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select date_trunc(p_bucket, created_at) as bucket,
    count(*), count(*) filter (where status between 400 and 499), count(*) filter (where status >= 500),
    count(*) filter (where status = 429), round(avg(duration_ms)::numeric, 1),
    round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 1),
    round(percentile_cont(0.99) within group (order by duration_ms)::numeric, 1)
  from public.api_requests
  where created_at >= p_from and (p_tenant is null or tenant_id = p_tenant) and (p_env is null or environment = p_env)
  group by 1 order by 1
$function$;

REVOKE ALL ON FUNCTION public.api_usage_series(p_tenant uuid, p_env text, p_from timestamp with time zone, p_bucket text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_usage_series(p_tenant uuid, p_env text, p_from timestamp with time zone, p_bucket text) TO service_role;

CREATE OR REPLACE FUNCTION public.b2b_usage_take(acc uuid, mon text, k text, lim integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur integer;
begin
  insert into public.lr_b2b_usage(account_id, month, kind, n) values (acc, mon, k, 0) on conflict do nothing;
  select n into cur from public.lr_b2b_usage where account_id = acc and month = mon and kind = k for update;
  if lim is not null and cur >= lim then return -1; end if;
  update public.lr_b2b_usage set n = n + 1, updated_at = now() where account_id = acc and month = mon and kind = k;
  return cur + 1;
end $function$;

REVOKE ALL ON FUNCTION public.b2b_usage_take(acc uuid, mon text, k text, lim integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_usage_take(acc uuid, mon text, k text, lim integer) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_card_authorize(p_card uuid, p_amount bigint, p_key text, p_merchant text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS TABLE(status text, tx_id uuid, available_after_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.lr_card_limits; c public.lr_cards; ex public.lr_card_transactions; avail bigint; credit bigint; st text; nid uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 120 then raise exception 'invalid_idempotency_key' using errcode = '22023'; end if;
  select * into l from public.lr_card_limits where card_id = p_card for update;
  if not found then raise exception 'card_not_found' using errcode = 'P0002'; end if;
  select * into ex from public.lr_card_transactions t where t.card_id = p_card and t.idempotency_key = p_key;
  if found then return query select ex.status, ex.id, ex.available_after_cents; return; end if;
  if l.reset_at <= now() then
    update public.lr_card_limits set settled_cents = 0, refunded_cents = 0, reset_at = public.lr_card_next_reset(now()), updated_at = now() where card_id = p_card returning * into l;
  end if;
  select * into c from public.lr_cards where id = p_card;
  avail := public.lr_card_available(l);
  credit := case when l.refunds_release_limit then l.refunded_cents else 0 end;
  if c.status in ('FROZEN','BLOCKED') then st := 'DECLINED_CARD_FROZEN';
  elsif c.status <> 'ACTIVE' then st := 'DECLINED_CARD_INACTIVE';
  elsif l.settled_cents + l.reserved_cents + p_amount - credit > l.monthly_limit_cents then st := 'DECLINED_LIMIT_EXCEEDED';
  else st := 'AUTHORIZED';
  end if;
  if st = 'AUTHORIZED' then
    update public.lr_card_limits set reserved_cents = reserved_cents + p_amount, updated_at = now() where card_id = p_card returning * into l;
  end if;
  insert into public.lr_card_transactions (card_id, kind, idempotency_key, amount_cents, status, merchant, category, available_before_cents, available_after_cents)
  values (p_card, 'authorization', p_key, p_amount, st, p_merchant, p_category, avail, public.lr_card_available(l)) returning id into nid;
  return query select st, nid, public.lr_card_available(l);
end $function$;

REVOKE ALL ON FUNCTION public.lr_card_authorize(p_card uuid, p_amount bigint, p_key text, p_merchant text, p_category text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_card_authorize(p_card uuid, p_amount bigint, p_key text, p_merchant text, p_category text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_card_available(l public.lr_card_limits)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select greatest(0, l.monthly_limit_cents - l.settled_cents - l.reserved_cents + case when l.refunds_release_limit then l.refunded_cents else 0 end);
$function$;

REVOKE ALL ON FUNCTION public.lr_card_available(l public.lr_card_limits) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_card_available(l public.lr_card_limits) TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_card_next_reset(p_at timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select (date_trunc('month', p_at at time zone 'Europe/Berlin') + interval '1 month') at time zone 'Europe/Berlin';
$function$;

REVOKE ALL ON FUNCTION public.lr_card_next_reset(p_at timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_card_next_reset(p_at timestamp with time zone) TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_card_refund(p_tx uuid, p_amount bigint, p_key text)
 RETURNS TABLE(status text, tx_id uuid, available_after_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.lr_card_transactions; l public.lr_card_limits; ex public.lr_card_transactions; done bigint; avail bigint; nid uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 120 then raise exception 'invalid_idempotency_key' using errcode = '22023'; end if;
  select * into t from public.lr_card_transactions where id = p_tx and kind = 'authorization';
  if not found then raise exception 'tx_not_found' using errcode = 'P0002'; end if;
  select * into l from public.lr_card_limits where card_id = t.card_id for update;
  select * into ex from public.lr_card_transactions x where x.card_id = t.card_id and x.idempotency_key = p_key;
  if found then return query select ex.status, ex.id, ex.available_after_cents; return; end if;
  if t.status <> 'SETTLED' then raise exception 'not_settled' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into done from public.lr_card_transactions where parent_id = p_tx and kind = 'refund';
  if done + p_amount > t.amount_cents then raise exception 'refund_exceeds_amount' using errcode = '22023'; end if;
  avail := public.lr_card_available(l);
  update public.lr_card_limits set refunded_cents = refunded_cents + p_amount, updated_at = now() where card_id = t.card_id returning * into l;
  insert into public.lr_card_transactions (card_id, kind, parent_id, idempotency_key, amount_cents, status, merchant, category, available_before_cents, available_after_cents)
  values (t.card_id, 'refund', p_tx, p_key, p_amount, 'REFUNDED', t.merchant, t.category, avail, public.lr_card_available(l)) returning id into nid;
  return query select 'REFUNDED'::text, nid, public.lr_card_available(l);
end $function$;

REVOKE ALL ON FUNCTION public.lr_card_refund(p_tx uuid, p_amount bigint, p_key text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_card_refund(p_tx uuid, p_amount bigint, p_key text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_card_settle(p_tx uuid, p_release boolean DEFAULT false)
 RETURNS TABLE(status text, available_after_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.lr_card_transactions; l public.lr_card_limits;
begin
  select * into t from public.lr_card_transactions where id = p_tx and kind = 'authorization';
  if not found then raise exception 'tx_not_found' using errcode = 'P0002'; end if;
  select * into l from public.lr_card_limits where card_id = t.card_id for update;
  select * into t from public.lr_card_transactions where id = p_tx for update;
  if t.status <> 'AUTHORIZED' then return query select t.status, public.lr_card_available(l); return; end if;
  if p_release then
    update public.lr_card_limits set reserved_cents = greatest(0, reserved_cents - t.amount_cents), updated_at = now() where card_id = t.card_id returning * into l;
    update public.lr_card_transactions set status = 'RELEASED', updated_at = now() where id = p_tx;
    return query select 'RELEASED'::text, public.lr_card_available(l);
  else
    update public.lr_card_limits set reserved_cents = greatest(0, reserved_cents - t.amount_cents), settled_cents = settled_cents + t.amount_cents, updated_at = now() where card_id = t.card_id returning * into l;
    update public.lr_card_transactions set status = 'SETTLED', updated_at = now() where id = p_tx;
    return query select 'SETTLED'::text, public.lr_card_available(l);
  end if;
end $function$;

REVOKE ALL ON FUNCTION public.lr_card_settle(p_tx uuid, p_release boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_card_settle(p_tx uuid, p_release boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_consume_share(p_token_hash text)
 RETURNS TABLE(id uuid, owner_id uuid, object_ref text, permissions jsonb, expires_at timestamp with time zone, view_count integer, max_views integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  update public.lr_data_room_shares s
     set view_count = s.view_count + 1
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     and (s.max_views is null or s.view_count < s.max_views)
  returning s.id, s.owner_id, s.object_ref, s.permissions, s.expires_at, s.view_count, s.max_views;
end;
$function$;

REVOKE ALL ON FUNCTION public.lr_consume_share(p_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_consume_share(p_token_hash text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_create_invoice(p jsonb)
 RETURNS public.lr_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  n bigint;
  ym text := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM');
  num text;
  r public.lr_invoices;
begin
  if coalesce(p->>'invoice_number','') <> '' then
    num := p->>'invoice_number';
  else
    insert into public.lr_counters(name, value) values ('invoice', 1)
      on conflict (name) do update set value = public.lr_counters.value + 1
      returning value into n;
    num := 'RE-' || ym || '-' || lpad(n::text, 5, '0');
  end if;
  insert into public.lr_invoices (invoice_number, kind, refers_to, source, account_id, buyer, items, net_cents, vat_rate, vat_cents, gross_cents,
    payment_method, payment_status, service_period, due_date, paid_at, stripe_invoice_id, stripe_pdf_url, created_by)
  values (num, p->>'kind', nullif(p->>'refers_to','')::uuid, p->>'source', nullif(p->>'account_id','')::uuid, p->'buyer', p->'items',
    (p->>'net_cents')::bigint, coalesce((p->>'vat_rate')::numeric, 19), (p->>'vat_cents')::bigint, (p->>'gross_cents')::bigint,
    p->>'payment_method', coalesce(p->>'payment_status','PENDING'), p->>'service_period', nullif(p->>'due_date','')::date,
    nullif(p->>'paid_at','')::timestamptz, nullif(p->>'stripe_invoice_id',''), nullif(p->>'stripe_pdf_url',''), p->>'created_by')
  returning * into r;
  return r;
end $function$;

REVOKE ALL ON FUNCTION public.lr_create_invoice(p jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_create_invoice(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_acceptance_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Agreement acceptances cannot be changed.';
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_acceptance_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_acceptance_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_account_deleted(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_account_deleted(p_user uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_account_deleted(p_user uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_adjustment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.statement_id is null then return old; end if;
    raise exception 'Settled adjustments are never deleted.';
  end if;
  if old.statement_id is not null then raise exception 'Settled adjustments cannot be changed.'; end if;
  if (to_jsonb(new) - 'statement_id') is distinct from (to_jsonb(old) - 'statement_id') then raise exception 'Adjustments cannot be changed; please delete and create a new one.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_adjustment_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_adjustment_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_agreement_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then raise exception 'Published agreements are never deleted.'; end if;
    return old;
  end if;
  if old.published_at is not null and (new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.version is distinct from old.version or new.title is distinct from old.title or new.published_at is distinct from old.published_at) then
    raise exception 'Published agreements cannot be changed. Please create a new version.';
  end if;
  if new.body_sha256 is distinct from encode(sha256(convert_to(new.body, 'UTF8')), 'hex') then
    raise exception 'Checksum does not match the text.';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_agreement_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_agreement_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_audit_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'The creator audit log cannot be changed.'; end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_audit_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_audit_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_bank_import_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'Imported bank statements cannot be changed.'; end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_bank_import_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_bank_import_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_billing_overview(p_period text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.lr_creator_billing_overview(p_period text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_billing_overview(p_period text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_campaign_stats(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(campaign text, creators bigint, visits bigint, registrations bigint, conversions bigint, revenue_net_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with codes as (select id, ref_code from public.lr_creators where ref_code is not null),
  v as (
    select coalesce(nullif(a.camp, ''), '') as camp, count(*) as n
    from public.lr_analytics a join codes c on a.src in ('partner' || c.ref_code, 'partner:' || c.ref_code)
    where a.ev = 'pv' and a.ts >= p_from and a.ts < p_to group by 1
  ),
  r as (select coalesce(campaign_slug, '') as camp, count(*) as n, count(distinct creator_id) as cr from public.lr_creator_attributions where created_at >= p_from and created_at < p_to group by 1),
  k as (select coalesce(campaign_slug, '') as camp, count(*) as n, sum(amount_net_cents) as cents, count(distinct creator_id) as cr from public.lr_creator_conversions where status = 'PENDING' and occurred_at >= p_from and occurred_at < p_to group by 1),
  camps as (select camp from v union select camp from r union select camp from k)
  select nullif(x.camp, ''), greatest(coalesce(r.cr, 0), coalesce(k.cr, 0)), coalesce(v.n, 0), coalesce(r.n, 0), coalesce(k.n, 0), coalesce(k.cents, 0)::bigint
  from camps x left join v on v.camp = x.camp left join r on r.camp = x.camp left join k on k.camp = x.camp
  order by 6 desc, 3 desc;
$function$;

REVOKE ALL ON FUNCTION public.lr_creator_campaign_stats(p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_campaign_stats(p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_can_see_campaign(p_campaign uuid, p_creator uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.lr_creator_campaigns k
    where k.id = p_campaign and k.status = 'ACTIVE'
      and (k.audience = 'ALL' or exists (select 1 from public.lr_creator_campaign_members m where m.campaign_id = k.id and m.creator_id = p_creator))
  );
$function$;

REVOKE ALL ON FUNCTION public.lr_creator_can_see_campaign(p_campaign uuid, p_creator uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_can_see_campaign(p_campaign uuid, p_creator uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s jsonb; l jsonb; sid uuid; n integer := 0; sumc bigint; nref integer;
begin
  if p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Invalid period.'; end if;
  perform pg_advisory_xact_lock(hashtext('lr_creator_close:' || p_period));
  for s in select * from jsonb_array_elements(coalesce(p_statements, '[]'::jsonb)) loop
    select coalesce(sum((x->>'commission_cents')::bigint), 0) into sumc from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) x;
    if sumc <> (s->>'commission_cents')::bigint then raise exception 'Sum of commission lines does not match.'; end if;
    if (s->>'net_cents')::bigint <> (s->>'commission_cents')::bigint + (s->>'adjustments_cents')::bigint then raise exception 'Net amount does not match.'; end if;
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
      raise exception 'Adjustments have changed in the meantime. Please close the period again.';
    end if;
    update public.lr_creator_refunds set processed_at = now(), processed_as = 'BASE'
      where id in (select (x#>>'{}')::uuid from jsonb_array_elements(coalesce(s->'refund_ids', '[]'::jsonb)) x)
        and creator_id = (s->>'creator_id')::uuid and processed_at is null;
    get diagnostics nref = row_count;
    if nref <> jsonb_array_length(coalesce(s->'refund_ids', '[]'::jsonb)) then
      raise exception 'Refunds have changed in the meantime. Please close the period again.';
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Commissions are never deleted.'; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then raise exception 'Commission amounts cannot be changed.'; end if;
  if old.status = 'CLAWED_BACK' then raise exception 'Clawback is final.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_commission_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_commission_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_conversion_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Conversions are never deleted.';
  end if;
  if new.creator_id is distinct from old.creator_id or new.source is distinct from old.source or new.stripe_session_id is distinct from old.stripe_session_id
     or new.amount_net_cents is distinct from old.amount_net_cents or new.currency is distinct from old.currency or new.occurred_at is distinct from old.occurred_at
     or new.campaign_slug is distinct from old.campaign_slug or new.created_at is distinct from old.created_at then
    raise exception 'Conversions cannot be changed.';
  end if;
  if old.status = 'REVERSED' and new.status <> 'REVERSED' then raise exception 'Reversal is final.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_conversion_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_conversion_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_document_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'Issued documents cannot be changed (record retention). Corrections only via cancellation and a new version.'; end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_document_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_document_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_next_number(p_name text)
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  insert into public.lr_counters (name, value) values (p_name, 1)
  on conflict (name) do update set value = public.lr_counters.value + 1
  returning value;
$function$;

REVOKE ALL ON FUNCTION public.lr_creator_next_number(p_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_next_number(p_name text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.creator_id is distinct from old.creator_id or new.holder_name is distinct from old.holder_name
     or new.iban_enc is distinct from old.iban_enc or new.iban_last4 is distinct from old.iban_last4
     or new.iban_country is distinct from old.iban_country or new.iban_fingerprint is distinct from old.iban_fingerprint
     or new.bic is distinct from old.bic or new.confirmed_at is distinct from old.confirmed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Payment details cannot be changed. Changes create a new record.';
  end if;
  if old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED' then
    raise exception 'Superseded payment details cannot be reactivated.';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_guard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Payment details are not deleted but superseded (SUPERSEDED).';
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_guard_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_guard_delete() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_reissue(p_payout uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p record; a record;
begin
  select * into p from public.lr_creator_payouts where id = p_payout for update;
  if not found then raise exception 'Payout not found.'; end if;
  if p.status <> 'RETURNED' then raise exception 'Only returned payouts can be reissued.'; end if;
  select id, status, iban_country, iban_last4 into a from public.lr_creator_payout_accounts
    where creator_id = p.creator_id and status <> 'SUPERSEDED' for update;
  if not found then raise exception 'The creator has no payment details on file.'; end if;
  if a.status = 'VERIFICATION_REQUIRED' then raise exception 'The payment details must be verified first.'; end if;
  update public.lr_creator_payouts set status = 'READY', payout_account_id = a.id, iban_country = a.iban_country, iban_last4 = a.iban_last4,
    approved_by = null, approved_at = null, exported_at = null, export_id = null, paid_by = null, paid_at = null, paid_via = null, bank_ref = null,
    created_by = p_actor, reissue_count = p.reissue_count + 1
  where id = p.id;
  return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'iban_last4', a.iban_last4);
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_reissue(p_payout uuid, p_actor text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_reissue(p_payout uuid, p_actor text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_replace(p_creator uuid, p_holder text, p_enc text, p_last4 text, p_country text, p_fingerprint text, p_bic text, p_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare nid uuid;
begin
  if p_status not in ('PROVIDED','VERIFICATION_REQUIRED') then raise exception 'Invalid initial status.'; end if;
  perform 1 from public.lr_creators where id = p_creator for update;
  if not found then raise exception 'Creator not found.'; end if;
  update public.lr_creator_payout_accounts set status = 'SUPERSEDED', superseded_at = now()
    where creator_id = p_creator and status <> 'SUPERSEDED';
  insert into public.lr_creator_payout_accounts (creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, bic, status, confirmed_at)
    values (p_creator, p_holder, p_enc, p_last4, p_country, p_fingerprint, p_bic, p_status, now())
    returning id into nid;
  return nid;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_replace(p_creator uuid, p_holder text, p_enc text, p_last4 text, p_country text, p_fingerprint text, p_bic text, p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_replace(p_creator uuid, p_holder text, p_enc text, p_last4 text, p_country text, p_fingerprint text, p_bic text, p_status text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_returned(p_payout uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p record;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'Please provide a reason.'; end if;
  select * into p from public.lr_creator_payouts where id = p_payout for update;
  if not found then raise exception 'Payout not found.'; end if;
  if p.status = 'RETURNED' then return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'changed', false); end if;
  if p.status <> 'PAID' then raise exception 'Only paid payouts can be returned.'; end if;
  perform set_config('lr.creator_payout_return', 'on', true);
  update public.lr_creator_payouts set status = 'RETURNED', returned_at = now(), failed_reason = left(trim(p_reason), 300) where id = p.id;
  update public.lr_creator_statements set status = 'APPROVED', paid_at = null where id = p.statement_id and status = 'PAID';
  update public.lr_creator_commissions set status = 'APPROVED' where statement_id = p.statement_id and status = 'PAID';
  update public.lr_creator_payout_accounts set status = 'VERIFICATION_REQUIRED' where id = p.payout_account_id and status in ('PROVIDED','VERIFIED');
  perform set_config('lr.creator_payout_return', 'off', true);
  return jsonb_build_object('creator_id', p.creator_id, 'amount_cents', p.amount_cents, 'changed', true);
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_returned(p_payout uuid, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_returned(p_payout uuid, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_payout_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare reissue boolean := old.status = 'RETURNED' and new.status = 'READY';
begin
  if tg_op = 'DELETE' then raise exception 'Payouts are never deleted.'; end if;
  if new.amount_cents is distinct from old.amount_cents or new.statement_id is distinct from old.statement_id
     or new.creator_id is distinct from old.creator_id or new.reference is distinct from old.reference then
    raise exception 'Amount, account and reference of a payout cannot be changed.';
  end if;
  if (new.payout_account_id is distinct from old.payout_account_id or new.iban_last4 is distinct from old.iban_last4
      or new.iban_country is distinct from old.iban_country) and not reissue then
    raise exception 'Amount, account and reference of a payout cannot be changed.';
  end if;
  if new.reissue_count < old.reissue_count then raise exception 'Counter cannot be reset.'; end if;
  if old.status = 'PAID' then
    if new.status <> 'RETURNED' then raise exception 'Paid payouts are final.'; end if;
    if (to_jsonb(new) - array['status','returned_at','failed_reason']) is distinct from (to_jsonb(old) - array['status','returned_at','failed_reason']) then
      raise exception 'Paid payouts are final.';
    end if;
  end if;
  if new.status = 'RETURNED' and old.status not in ('PAID','RETURNED') then raise exception 'Only paid payouts can be returned.'; end if;
  if old.status = 'RETURNED' and new.status not in ('RETURNED','READY') then raise exception 'Returned payouts can only be reissued.'; end if;
  if new.status = 'PAID' and old.status not in ('APPROVED','EXPORTED') then raise exception 'Only approved payouts can be marked as paid.'; end if;
  if new.status = 'EXPORTED' and old.status <> 'APPROVED' and old.status <> 'EXPORTED' then raise exception 'Only approved payouts can be exported.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_payout_status_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_payout_status_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_performance(p_creator uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with c as (select ref_code from public.lr_creators where id = p_creator),
  v as (
    select coalesce(nullif(a.camp, ''), '') as camp, count(*) as views, count(distinct a.visitor) as visitors
    from public.lr_analytics a, c
    where c.ref_code is not null and a.ev = 'pv' and a.ts >= p_from and a.ts < p_to
      and a.src in ('partner' || c.ref_code, 'partner:' || c.ref_code)
    group by 1
  ),
  r as (
    select coalesce(campaign_slug, '') as camp, count(*) as registrations
    from public.lr_creator_attributions where creator_id = p_creator and created_at >= p_from and created_at < p_to group by 1
  ),
  k as (
    select coalesce(campaign_slug, '') as camp,
      count(*) filter (where status = 'PENDING') as conversions,
      coalesce(sum(amount_net_cents) filter (where status = 'PENDING'), 0) as revenue_net_cents,
      count(*) filter (where status = 'REVERSED') as reversed,
      count(*) filter (where source = 'code' and status = 'PENDING') as via_code
    from public.lr_creator_conversions where creator_id = p_creator and occurred_at >= p_from and occurred_at < p_to group by 1
  ),
  camps as (select camp from v union select camp from r union select camp from k)
  select jsonb_build_object(
    'visits', coalesce((select sum(views) from v), 0),
    'visitors', coalesce((select sum(visitors) from v), 0),
    'registrations', coalesce((select sum(registrations) from r), 0),
    'conversions', coalesce((select sum(conversions) from k), 0),
    'revenue_net_cents', coalesce((select sum(revenue_net_cents) from k), 0),
    'reversed', coalesce((select sum(reversed) from k), 0),
    'via_code', coalesce((select sum(via_code) from k), 0),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object(
        'campaign', nullif(x.camp, ''), 'visits', coalesce(v.views, 0), 'registrations', coalesce(r.registrations, 0),
        'conversions', coalesce(k.conversions, 0), 'revenue_net_cents', coalesce(k.revenue_net_cents, 0)) order by coalesce(k.revenue_net_cents, 0) desc, coalesce(v.views, 0) desc)
      from camps x left join v on v.camp = x.camp left join r on r.camp = x.camp left join k on k.camp = x.camp), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.lr_creator_performance(p_creator uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_performance(p_creator uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_record_refund(p_payment_intent text, p_charge text, p_amount bigint, p_refunded bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_record_refund(p_payment_intent text, p_charge text, p_amount bigint, p_refunded bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_record_refund(p_payment_intent text, p_charge text, p_amount bigint, p_refunded bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_refund_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Refunds are never deleted.'; end if;
  if (to_jsonb(new) - array['processed_at','processed_as']) is distinct from (to_jsonb(old) - array['processed_at','processed_as']) then
    raise exception 'Refunds cannot be changed.';
  end if;
  if old.processed_at is not null then raise exception 'Refund has already been settled.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_refund_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_refund_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_review_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'The review history cannot be changed.';
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_review_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_review_immutable() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_rule_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Commission rules are not deleted but ended.';
  end if;
  if (to_jsonb(new) - 'valid_to') is distinct from (to_jsonb(old) - 'valid_to') then raise exception 'Commission rules are versioned and cannot be changed.'; end if;
  if old.valid_to is not null and new.valid_to is distinct from old.valid_to then raise exception 'Rule has already ended.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_rule_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_rule_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_creator_statement_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare ord text[] := array['READY','INVOICED','APPROVED','PAID'];
        free text[] := array['status','approved_at','approved_by','paid_at','carried_over','notified_at','reminded_at'];
        back boolean := old.status = 'PAID' and new.status = 'APPROVED' and coalesce(current_setting('lr.creator_payout_return', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'Statements are never deleted.'; end if;
  if (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'Closed statements cannot be changed.';
  end if;
  if old.status = 'ZERO' and new.status <> 'ZERO' then raise exception 'A statement without an amount stays closed.'; end if;
  if old.status <> 'ZERO' and array_position(ord, new.status) < array_position(ord, old.status) and not back then raise exception 'Status cannot be reset.'; end if;
  if old.carried_over and not new.carried_over then raise exception 'Carry-over is final.'; end if;
  if old.notified_at is not null and new.notified_at is distinct from old.notified_at then raise exception 'Notification is already recorded.'; end if;
  if old.reminded_at is not null and new.reminded_at is distinct from old.reminded_at then raise exception 'Reminder is already recorded.'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_creator_statement_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_creator_statement_guard() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_email_status(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select jsonb_build_object(
        'exists', true,
        'confirmed', u.email_confirmed_at is not null,
        'password', u.encrypted_password is not null and u.encrypted_password <> '',
        'providers', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
     from auth.users u where lower(u.email) = lower(trim(p_email)) and u.deleted_at is null limit 1),
    jsonb_build_object('exists', false));
$function$;

REVOKE ALL ON FUNCTION public.lr_email_status(p_email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_email_status(p_email text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_invoices_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoices must not be deleted (record retention).';
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
    raise exception 'Invoice contents cannot be changed. Please issue a credit note.';
  end if;
  if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
    raise exception 'The stored invoice PDF cannot be changed.';
  end if;
  if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'The checksum cannot be changed.';
  end if;
  if old.stripe_pdf_url is not null and new.stripe_pdf_url is distinct from old.stripe_pdf_url then
    raise exception 'The invoice link cannot be changed.';
  end if;
  if new.account_id is distinct from old.account_id and new.account_id is not null then
    raise exception 'The account link can only be removed.';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.lr_invoices_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_invoices_guard() TO service_role;

CREATE OR REPLACE FUNCTION public.lr_invoices_no_truncate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'Invoices must not be deleted (record retention).'; end $function$;

REVOKE ALL ON FUNCTION public.lr_invoices_no_truncate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_invoices_no_truncate() TO service_role;

CREATE OR REPLACE FUNCTION public.lr_log_client_error(fp text, msg text, src text, pg text, ar text, br text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.lr_client_errors (fingerprint, message, source, page, area, browser)
  values (fp, left(msg, 300), left(src, 200), left(pg, 120), left(ar, 20), left(br, 40))
  on conflict (fingerprint) do update set count = public.lr_client_errors.count + 1, last_seen = now(), resolved_at = null,
    page = excluded.page, browser = excluded.browser;
$function$;

REVOKE ALL ON FUNCTION public.lr_log_client_error(fp text, msg text, src text, pg text, ar text, br text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_log_client_error(fp text, msg text, src text, pg text, ar text, br text) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_mfa_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$function$;

REVOKE ALL ON FUNCTION public.lr_mfa_ok() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_mfa_ok() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_revoke_sessions(keep_emails text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
declare n integer;
begin
  with gone as (
    delete from auth.sessions s
    using auth.users u
    where s.user_id = u.id and lower(coalesce(u.email, '')) <> all (select lower(e) from unnest(keep_emails) e)
    returning s.id
  ) select count(*) into n from gone;
  delete from auth.refresh_tokens r
    using auth.users u
    where r.user_id::uuid = u.id and lower(coalesce(u.email, '')) <> all (select lower(e) from unnest(keep_emails) e);
  return n;
end;
$function$;

REVOKE ALL ON FUNCTION public.lr_revoke_sessions(keep_emails text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_revoke_sessions(keep_emails text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.lr_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin new.updated_at=now(); return new; end; $function$;

REVOKE ALL ON FUNCTION public.lr_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_touch_updated_at() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lr_user_data_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.lr_user_data_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_user_data_set_updated_at() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.next_bank_pdf_version(p_package_id uuid, p_sha256_hex text, p_storage_path text, p_byte_size bigint, p_storage_bucket text DEFAULT 'bank-ready-pdf'::text)
 RETURNS lr_bank_pdf_versions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare v_owner uuid; v_no integer; v_row public.lr_bank_pdf_versions; begin if p_sha256_hex !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if; if p_byte_size <= 0 then raise exception 'invalid_byte_size'; end if; select owner_id into v_owner from public.lr_bank_packages where id=p_package_id; if v_owner is null or v_owner <> auth.uid() then raise exception 'package_not_owned'; end if; if exists(select 1 from public.lr_bank_pdf_versions where package_id=p_package_id and sha256_hex=p_sha256_hex) then raise exception 'duplicate_pdf_hash'; end if; if exists(select 1 from public.lr_bank_pdf_versions where storage_bucket=p_storage_bucket and storage_path=p_storage_path) then raise exception 'duplicate_storage_path'; end if; select coalesce(max(version_no),0)+1 into v_no from public.lr_bank_pdf_versions where package_id=p_package_id; insert into public.lr_bank_pdf_versions(package_id,version_no,sha256_hex,storage_path,storage_bucket,mime_type,byte_size) values(p_package_id,v_no,p_sha256_hex,p_storage_path,p_storage_bucket,'application/pdf',p_byte_size) returning * into v_row; insert into public.lr_bank_pdf_audit(pdf_version_id,package_id,event_type,actor_id,metadata) values(v_row.id,v_row.package_id,'generated',auth.uid(),jsonb_build_object('sha256_hex',v_row.sha256_hex,'byte_size',v_row.byte_size,'storage_bucket',v_row.storage_bucket,'storage_path',v_row.storage_path)); return v_row; end; $function$;

REVOKE ALL ON FUNCTION public.next_bank_pdf_version(p_package_id uuid, p_sha256_hex text, p_storage_path text, p_byte_size bigint, p_storage_bucket text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_bank_pdf_version(p_package_id uuid, p_sha256_hex text, p_storage_path text, p_byte_size bigint, p_storage_bucket text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_bank_share(p_share_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare v_package uuid; begin select package_id into v_package from public.lr_bank_share_links l join public.lr_bank_packages p on p.id=l.package_id where l.id=p_share_id and p.owner_id=auth.uid(); if v_package is null then raise exception 'share_not_owned'; end if; update public.lr_bank_share_links set revoked_at=now() where id=p_share_id and revoked_at is null; if not found then return false; end if; insert into public.lr_bank_share_events(share_link_id,package_id,event_type,actor_id) select id,package_id,'revoked',auth.uid() from public.lr_bank_share_links where id=p_share_id; return true; end; $function$;

REVOKE ALL ON FUNCTION public.revoke_bank_share(p_share_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_bank_share(p_share_id uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_lr_updated_at()
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
$function$;

REVOKE ALL ON FUNCTION public.set_lr_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_lr_updated_at() TO PUBLIC, anon, authenticated, service_role;


-- ===================== 4a.sql =====================
ALTER TABLE public.api_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_validation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_verification_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_pdf_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_pdf_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_pricing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_bank_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_socials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_data_room_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_data_room_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kaeufe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kreditmappe_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kreditmappe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_outreach_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_security_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_security_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_verify_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_webhook_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_counters ENABLE ROW LEVEL SECURITY;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_access_audit' AND policyname = 'audit_owner_read') THEN
  CREATE POLICY audit_owner_read ON public.lr_access_audit AS PERMISSIVE FOR SELECT TO public USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_packages' AND policyname = 'bank_packages_owner_insert') THEN
  CREATE POLICY bank_packages_owner_insert ON public.lr_bank_packages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_packages' AND policyname = 'bank_packages_owner_select') THEN
  CREATE POLICY bank_packages_owner_select ON public.lr_bank_packages AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_packages' AND policyname = 'bank_packages_owner_update') THEN
  CREATE POLICY bank_packages_owner_update ON public.lr_bank_packages AS PERMISSIVE FOR UPDATE TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_pdf_audit' AND policyname = 'bank_pdf_audit_owner_select') THEN
  CREATE POLICY bank_pdf_audit_owner_select ON public.lr_bank_pdf_audit AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_bank_packages p
  WHERE ((p.id = lr_bank_pdf_audit.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_pdf_versions' AND policyname = 'bank_pdf_versions_owner_select') THEN
  CREATE POLICY bank_pdf_versions_owner_select ON public.lr_bank_pdf_versions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_bank_packages p
  WHERE ((p.id = lr_bank_pdf_versions.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_share_events' AND policyname = 'bank_share_events_owner_select') THEN
  CREATE POLICY bank_share_events_owner_select ON public.lr_bank_share_events AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_bank_packages p
  WHERE ((p.id = lr_bank_share_events.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_bank_share_links' AND policyname = 'bank_share_links_owner_select') THEN
  CREATE POLICY bank_share_links_owner_select ON public.lr_bank_share_links AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_bank_packages p
  WHERE ((p.id = lr_bank_share_links.package_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_card_applications' AND policyname = 'card_apps_own') THEN
  CREATE POLICY card_apps_own ON public.lr_card_applications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_card_limits' AND policyname = 'card_limits_own') THEN
  CREATE POLICY card_limits_own ON public.lr_card_limits AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_cards c
  WHERE ((c.id = lr_card_limits.card_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_card_transactions' AND policyname = 'card_tx_own') THEN
  CREATE POLICY card_tx_own ON public.lr_card_transactions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_cards c
  WHERE ((c.id = lr_card_transactions.card_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_cards' AND policyname = 'cards_own') THEN
  CREATE POLICY cards_own ON public.lr_cards AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_agreement_acceptances' AND policyname = 'creator_acceptances_select_own') THEN
  CREATE POLICY creator_acceptances_select_own ON public.lr_creator_agreement_acceptances AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_agreement_acceptances.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_agreements' AND policyname = 'creator_agreements_select_published') THEN
  CREATE POLICY creator_agreements_select_published ON public.lr_creator_agreements AS PERMISSIVE FOR SELECT TO authenticated USING ((published_at IS NOT NULL));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_assets' AND policyname = 'creator_assets_select_visible') THEN
  CREATE POLICY creator_assets_select_visible ON public.lr_creator_assets AS PERMISSIVE FOR SELECT TO authenticated USING ((active AND lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.user_id = ( SELECT auth.uid() AS uid)) AND (c.status = 'ACTIVE'::text) AND ((lr_creator_assets.campaign_id IS NULL) OR lr_creator_can_see_campaign(lr_creator_assets.campaign_id, c.id)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_benefits' AND policyname = 'creator_benefits_select_own') THEN
  CREATE POLICY creator_benefits_select_own ON public.lr_creator_benefits AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_benefits.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_business' AND policyname = 'creator_business_select_own') THEN
  CREATE POLICY creator_business_select_own ON public.lr_creator_business AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_business.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND lr_mfa_ok()));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_campaigns' AND policyname = 'creator_campaigns_select_visible') THEN
  CREATE POLICY creator_campaigns_select_visible ON public.lr_creator_campaigns AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.user_id = ( SELECT auth.uid() AS uid)) AND (c.status = 'ACTIVE'::text) AND lr_creator_can_see_campaign(lr_creator_campaigns.id, c.id))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_content' AND policyname = 'creator_content_select_own') THEN
  CREATE POLICY creator_content_select_own ON public.lr_creator_content AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_content.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_documents' AND policyname = 'creator_documents_select_own') THEN
  CREATE POLICY creator_documents_select_own ON public.lr_creator_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_documents.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_payouts' AND policyname = 'creator_payouts_select_own') THEN
  CREATE POLICY creator_payouts_select_own ON public.lr_creator_payouts AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_payouts.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_reviews' AND policyname = 'creator_reviews_select_own_visible') THEN
  CREATE POLICY creator_reviews_select_own_visible ON public.lr_creator_reviews AS PERMISSIVE FOR SELECT TO authenticated USING ((visible_to_creator AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_reviews.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_socials' AND policyname = 'creator_socials_select_own') THEN
  CREATE POLICY creator_socials_select_own ON public.lr_creator_socials AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_socials.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))) AND lr_mfa_ok()));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creator_statements' AND policyname = 'creator_statements_select_own') THEN
  CREATE POLICY creator_statements_select_own ON public.lr_creator_statements AS PERMISSIVE FOR SELECT TO authenticated USING ((lr_mfa_ok() AND (EXISTS ( SELECT 1
   FROM lr_creators c
  WHERE ((c.id = lr_creator_statements.creator_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_creators' AND policyname = 'creators_select_own') THEN
  CREATE POLICY creators_select_own ON public.lr_creators AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND lr_mfa_ok()));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_data_room_access_log' AND policyname = 'room_access_owner_select') THEN
  CREATE POLICY room_access_owner_select ON public.lr_data_room_access_log AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_data_room_shares' AND policyname = 'lr_share_owner_insert_v2') THEN
  CREATE POLICY lr_share_owner_insert_v2 ON public.lr_data_room_shares AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_data_room_shares' AND policyname = 'lr_share_owner_select_v2') THEN
  CREATE POLICY lr_share_owner_select_v2 ON public.lr_data_room_shares AS PERMISSIVE FOR SELECT TO authenticated USING ((created_by = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_data_room_shares' AND policyname = 'lr_share_owner_update_v2') THEN
  CREATE POLICY lr_share_owner_update_v2 ON public.lr_data_room_shares AS PERMISSIVE FOR UPDATE TO authenticated USING ((created_by = ( SELECT auth.uid() AS uid))) WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_data_room_shares' AND policyname = 'lr_shares_mfa') THEN
  CREATE POLICY lr_shares_mfa ON public.lr_data_room_shares AS RESTRICTIVE FOR ALL TO authenticated USING (lr_mfa_ok()) WITH CHECK (lr_mfa_ok());
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_deals' AND policyname = 'deals_owner_all') THEN
  CREATE POLICY deals_owner_all ON public.lr_deals AS PERMISSIVE FOR ALL TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_document_events' AND policyname = 'lr_document_events_insert') THEN
  CREATE POLICY lr_document_events_insert ON public.lr_document_events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_document_events' AND policyname = 'lr_document_events_select') THEN
  CREATE POLICY lr_document_events_select ON public.lr_document_events AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_document_requests' AND policyname = 'doc_requests_owner_select') THEN
  CREATE POLICY doc_requests_owner_select ON public.lr_document_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_documents' AND policyname = 'documents_no_client_insert') THEN
  CREATE POLICY documents_no_client_insert ON public.lr_documents AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_documents' AND policyname = 'documents_no_client_update') THEN
  CREATE POLICY documents_no_client_update ON public.lr_documents AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_documents' AND policyname = 'documents_owner_all') THEN
  CREATE POLICY documents_owner_all ON public.lr_documents AS PERMISSIVE FOR ALL TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_documents' AND policyname = 'lr_documents_mfa') THEN
  CREATE POLICY lr_documents_mfa ON public.lr_documents AS RESTRICTIVE FOR ALL TO authenticated USING (lr_mfa_ok()) WITH CHECK (lr_mfa_ok());
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_entitlements' AND policyname = 'lr_entitlements_select_own') THEN
  CREATE POLICY lr_entitlements_select_own ON public.lr_entitlements AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = user_id));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_kreditmappe_credits' AND policyname = 'km_credits_owner_select') THEN
  CREATE POLICY km_credits_owner_select ON public.lr_kreditmappe_credits AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_kreditmappe_versions' AND policyname = 'lr_km_versions_mfa') THEN
  CREATE POLICY lr_km_versions_mfa ON public.lr_kreditmappe_versions AS RESTRICTIVE FOR SELECT TO authenticated USING (lr_mfa_ok());
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_kreditmappe_versions' AND policyname = 'km_versions_owner_select') THEN
  CREATE POLICY km_versions_owner_select ON public.lr_kreditmappe_versions AS PERMISSIVE FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_reminder_log' AND policyname = 'lr_reminder_log_select_own') THEN
  CREATE POLICY lr_reminder_log_select_own ON public.lr_reminder_log AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_user_data' AND policyname = 'lr_user_data_insert_own') THEN
  CREATE POLICY lr_user_data_insert_own ON public.lr_user_data AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_user_data' AND policyname = 'lr_user_data_mfa') THEN
  CREATE POLICY lr_user_data_mfa ON public.lr_user_data AS RESTRICTIVE FOR ALL TO authenticated USING (lr_mfa_ok()) WITH CHECK (lr_mfa_ok());
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_user_data' AND policyname = 'lr_user_data_select_own') THEN
  CREATE POLICY lr_user_data_select_own ON public.lr_user_data AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lr_user_data' AND policyname = 'lr_user_data_update_own') THEN
  CREATE POLICY lr_user_data_update_own ON public.lr_user_data AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
END IF; END $do$;
CREATE OR REPLACE TRIGGER api_audit_chain_trg BEFORE INSERT ON public.api_audit_events FOR EACH ROW EXECUTE FUNCTION api_audit_chain();
CREATE OR REPLACE TRIGGER api_audit_immutable_trg BEFORE DELETE OR UPDATE ON public.api_audit_events FOR EACH ROW EXECUTE FUNCTION api_audit_immutable();
CREATE OR REPLACE TRIGGER lr_creator_adjustment_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_adjustments FOR EACH ROW EXECUTE FUNCTION lr_creator_adjustment_guard();
CREATE OR REPLACE TRIGGER lr_creator_admin_roles_touch BEFORE UPDATE ON public.lr_creator_admin_roles FOR EACH ROW EXECUTE FUNCTION lr_touch_updated_at();
CREATE OR REPLACE TRIGGER lr_creator_acceptance_no_change BEFORE DELETE OR UPDATE ON public.lr_creator_agreement_acceptances FOR EACH ROW EXECUTE FUNCTION lr_creator_acceptance_immutable();
CREATE OR REPLACE TRIGGER lr_creator_agreement_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_agreements FOR EACH ROW EXECUTE FUNCTION lr_creator_agreement_guard();
CREATE OR REPLACE TRIGGER lr_creator_audit_no_change BEFORE DELETE OR UPDATE ON public.lr_creator_audit FOR EACH ROW EXECUTE FUNCTION lr_creator_audit_immutable();
CREATE OR REPLACE TRIGGER lr_creator_audit_no_truncate BEFORE TRUNCATE ON public.lr_creator_audit FOR EACH STATEMENT EXECUTE FUNCTION lr_creator_audit_immutable();
CREATE OR REPLACE TRIGGER lr_creator_bank_import_no_change BEFORE DELETE OR UPDATE ON public.lr_creator_bank_imports FOR EACH ROW EXECUTE FUNCTION lr_creator_bank_import_immutable();
CREATE OR REPLACE TRIGGER lr_creator_benefits_touch BEFORE UPDATE ON public.lr_creator_benefits FOR EACH ROW EXECUTE FUNCTION lr_touch_updated_at();
CREATE OR REPLACE TRIGGER lr_creator_business_touch BEFORE UPDATE ON public.lr_creator_business FOR EACH ROW EXECUTE FUNCTION lr_touch_updated_at();
CREATE OR REPLACE TRIGGER lr_creator_campaigns_touch BEFORE UPDATE ON public.lr_creator_campaigns FOR EACH ROW EXECUTE FUNCTION lr_touch_updated_at();
CREATE OR REPLACE TRIGGER lr_creator_rule_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_commission_rules FOR EACH ROW EXECUTE FUNCTION lr_creator_rule_guard();
CREATE OR REPLACE TRIGGER lr_creator_commission_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_commissions FOR EACH ROW EXECUTE FUNCTION lr_creator_commission_guard();
CREATE OR REPLACE TRIGGER lr_creator_conversion_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_conversions FOR EACH ROW EXECUTE FUNCTION lr_creator_conversion_guard();
CREATE OR REPLACE TRIGGER lr_creator_document_immutable_trg BEFORE DELETE OR UPDATE ON public.lr_creator_documents FOR EACH ROW EXECUTE FUNCTION lr_creator_document_immutable();
CREATE OR REPLACE TRIGGER lr_creator_payout_guard_del_trg BEFORE DELETE ON public.lr_creator_payout_accounts FOR EACH ROW EXECUTE FUNCTION lr_creator_payout_guard_delete();
CREATE OR REPLACE TRIGGER lr_creator_payout_guard_trg BEFORE UPDATE ON public.lr_creator_payout_accounts FOR EACH ROW EXECUTE FUNCTION lr_creator_payout_guard();
CREATE OR REPLACE TRIGGER lr_creator_payout_status_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_payouts FOR EACH ROW EXECUTE FUNCTION lr_creator_payout_status_guard();
CREATE OR REPLACE TRIGGER lr_creator_refund_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_refunds FOR EACH ROW EXECUTE FUNCTION lr_creator_refund_guard();
CREATE OR REPLACE TRIGGER lr_creator_review_no_change BEFORE DELETE OR UPDATE ON public.lr_creator_reviews FOR EACH ROW EXECUTE FUNCTION lr_creator_review_immutable();
CREATE OR REPLACE TRIGGER lr_creator_statement_guard_trg BEFORE DELETE OR UPDATE ON public.lr_creator_statements FOR EACH ROW EXECUTE FUNCTION lr_creator_statement_guard();
CREATE OR REPLACE TRIGGER lr_creators_touch BEFORE UPDATE ON public.lr_creators FOR EACH ROW EXECUTE FUNCTION lr_touch_updated_at();
CREATE OR REPLACE TRIGGER lr_invoices_guard_trunc BEFORE TRUNCATE ON public.lr_invoices FOR EACH STATEMENT EXECUTE FUNCTION lr_invoices_no_truncate();
CREATE OR REPLACE TRIGGER lr_invoices_guard_upd BEFORE DELETE OR UPDATE ON public.lr_invoices FOR EACH ROW EXECUTE FUNCTION lr_invoices_guard();
CREATE OR REPLACE TRIGGER lr_user_data_updated_at BEFORE UPDATE ON public.lr_user_data FOR EACH ROW EXECUTE FUNCTION lr_user_data_set_updated_at();
CREATE OR REPLACE TRIGGER trg_lr_user_data_updated BEFORE UPDATE ON public.lr_user_data FOR EACH ROW EXECUTE FUNCTION set_lr_updated_at();

-- ===================== 4b.sql =====================
REVOKE ALL ON TABLE public.api_audit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_audit_events TO service_role;
REVOKE ALL ON TABLE public.api_cases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_cases TO service_role;
REVOKE ALL ON TABLE public.api_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_documents TO service_role;
REVOKE ALL ON TABLE public.api_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_idempotency_keys TO service_role;
REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_keys TO service_role;
REVOKE ALL ON TABLE public.api_rate_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_rate_counters TO service_role;
REVOKE ALL ON TABLE public.api_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_reports TO service_role;
REVOKE ALL ON TABLE public.api_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_requests TO service_role;
REVOKE ALL ON TABLE public.api_tenant_policies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_tenant_policies TO service_role;
REVOKE ALL ON TABLE public.api_validation_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_validation_runs TO service_role;
REVOKE ALL ON TABLE public.api_webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_webhook_deliveries TO service_role;
REVOKE ALL ON TABLE public.api_webhook_endpoints FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_webhook_endpoints TO service_role;
REVOKE ALL ON TABLE public.lr_access_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_access_audit TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_access_audit TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_access_audit TO authenticated;
REVOKE ALL ON TABLE public.lr_access_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_access_grants TO service_role;
REVOKE ALL ON TABLE public.lr_admin_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_admin_audit TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_admin_audit TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_admin_audit TO authenticated;
REVOKE ALL ON TABLE public.lr_admin_push_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_admin_push_tokens TO service_role;
REVOKE ALL ON TABLE public.lr_admin_roles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_admin_roles TO service_role;
REVOKE ALL ON TABLE public.lr_analytics FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_analytics TO service_role;
REVOKE ALL ON TABLE public.lr_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_audit_log TO service_role;
REVOKE ALL ON TABLE public.lr_b2b_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_accounts TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_accounts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_accounts TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_clients FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_clients TO service_role;
REVOKE ALL ON TABLE public.lr_b2b_contact FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_contact TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_contact TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_contact TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_invites TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_invites TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_invites TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_leads TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_leads TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_leads TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_members TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_members TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_members TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_partner_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_partner_codes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_partner_codes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_partner_codes TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_submissions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_submissions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_submissions TO authenticated;
REVOKE ALL ON TABLE public.lr_b2b_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_usage TO service_role;
REVOKE ALL ON TABLE public.lr_b2b_verification_docs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_b2b_verification_docs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_verification_docs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_b2b_verification_docs TO authenticated;
REVOKE ALL ON TABLE public.lr_bank_packages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bank_packages TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_packages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_packages TO authenticated;
REVOKE ALL ON TABLE public.lr_bank_pdf_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bank_pdf_audit TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_pdf_audit TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_pdf_audit TO authenticated;
REVOKE ALL ON TABLE public.lr_bank_pdf_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bank_pdf_versions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_pdf_versions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_pdf_versions TO authenticated;
REVOKE ALL ON TABLE public.lr_bank_share_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bank_share_events TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_share_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_share_events TO authenticated;
REVOKE ALL ON TABLE public.lr_bank_share_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bank_share_links TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_share_links TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_bank_share_links TO authenticated;
REVOKE ALL ON TABLE public.lr_bookings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_bookings TO service_role;
REVOKE ALL ON TABLE public.lr_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_campaigns TO service_role;
REVOKE ALL ON TABLE public.lr_card_applications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_applications TO service_role;
GRANT SELECT ON TABLE public.lr_card_applications TO authenticated;
REVOKE ALL ON TABLE public.lr_card_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_audit TO service_role;
REVOKE ALL ON TABLE public.lr_card_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_limits TO service_role;
GRANT SELECT ON TABLE public.lr_card_limits TO authenticated;
REVOKE ALL ON TABLE public.lr_card_pricing_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_pricing_items TO service_role;
REVOKE ALL ON TABLE public.lr_card_pricing_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_pricing_versions TO service_role;
REVOKE ALL ON TABLE public.lr_card_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_card_transactions TO service_role;
GRANT SELECT ON TABLE public.lr_card_transactions TO authenticated;
REVOKE ALL ON TABLE public.lr_cards FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_cards TO service_role;
GRANT SELECT ON TABLE public.lr_cards TO authenticated;
REVOKE ALL ON TABLE public.lr_client_errors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_client_errors TO service_role;
REVOKE ALL ON TABLE public.lr_creator_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_adjustments TO service_role;
REVOKE ALL ON TABLE public.lr_creator_admin_roles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_admin_roles TO service_role;
REVOKE ALL ON TABLE public.lr_creator_agreement_acceptances FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_agreement_acceptances TO service_role;
GRANT SELECT ON TABLE public.lr_creator_agreement_acceptances TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_agreements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_agreements TO service_role;
GRANT SELECT ON TABLE public.lr_creator_agreements TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_assets TO service_role;
GRANT SELECT ON TABLE public.lr_creator_assets TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_attributions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_attributions TO service_role;
REVOKE ALL ON TABLE public.lr_creator_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_audit TO service_role;
REVOKE ALL ON TABLE public.lr_creator_bank_imports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_bank_imports TO service_role;
REVOKE ALL ON TABLE public.lr_creator_benefits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_benefits TO service_role;
GRANT SELECT ON TABLE public.lr_creator_benefits TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_business FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_business TO service_role;
GRANT SELECT ON TABLE public.lr_creator_business TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_campaign_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_campaign_members TO service_role;
REVOKE ALL ON TABLE public.lr_creator_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_campaigns TO service_role;
GRANT SELECT ON TABLE public.lr_creator_campaigns TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_commission_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_commission_rules TO service_role;
REVOKE ALL ON TABLE public.lr_creator_commissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_commissions TO service_role;
REVOKE ALL ON TABLE public.lr_creator_content FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_content TO service_role;
GRANT SELECT ON TABLE public.lr_creator_content TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_conversions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_conversions TO service_role;
REVOKE ALL ON TABLE public.lr_creator_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_documents TO service_role;
GRANT SELECT ON TABLE public.lr_creator_documents TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_payout_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_payout_accounts TO service_role;
REVOKE ALL ON TABLE public.lr_creator_payouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_payouts TO service_role;
GRANT SELECT ON TABLE public.lr_creator_payouts TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_refunds TO service_role;
REVOKE ALL ON TABLE public.lr_creator_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_reviews TO service_role;
GRANT SELECT ON TABLE public.lr_creator_reviews TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_socials FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_socials TO service_role;
GRANT SELECT ON TABLE public.lr_creator_socials TO authenticated;
REVOKE ALL ON TABLE public.lr_creator_statements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creator_statements TO service_role;
GRANT SELECT ON TABLE public.lr_creator_statements TO authenticated;
REVOKE ALL ON TABLE public.lr_creators FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_creators TO service_role;
GRANT SELECT ON TABLE public.lr_creators TO authenticated;
REVOKE ALL ON TABLE public.lr_crm_activities FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_crm_activities TO service_role;
REVOKE ALL ON TABLE public.lr_crm_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_crm_contacts TO service_role;
REVOKE ALL ON TABLE public.lr_data_room_access_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_data_room_access_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_data_room_access_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_data_room_access_log TO authenticated;
REVOKE ALL ON TABLE public.lr_data_room_shares FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_data_room_shares TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_data_room_shares TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_data_room_shares TO authenticated;
REVOKE ALL ON TABLE public.lr_deals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_deals TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_deals TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_deals TO authenticated;
REVOKE ALL ON TABLE public.lr_document_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_document_events TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_document_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_document_events TO authenticated;
REVOKE ALL ON TABLE public.lr_document_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_document_requests TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.lr_document_requests TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.lr_document_requests TO authenticated;
REVOKE ALL ON TABLE public.lr_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_documents TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_documents TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_documents TO authenticated;
REVOKE ALL ON TABLE public.lr_entitlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_entitlements TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_entitlements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_entitlements TO authenticated;
REVOKE ALL ON TABLE public.lr_feedback FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_feedback TO service_role;
REVOKE ALL ON TABLE public.lr_invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_invoices TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_invoices TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_invoices TO authenticated;
REVOKE ALL ON TABLE public.lr_kaeufe FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_kaeufe TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_kaeufe TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_kaeufe TO authenticated;
REVOKE ALL ON TABLE public.lr_kreditmappe_credits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_kreditmappe_credits TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.lr_kreditmappe_credits TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.lr_kreditmappe_credits TO authenticated;
REVOKE ALL ON TABLE public.lr_kreditmappe_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_kreditmappe_versions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_kreditmappe_versions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_kreditmappe_versions TO authenticated;
REVOKE ALL ON TABLE public.lr_mail_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_mail_messages TO service_role;
REVOKE ALL ON TABLE public.lr_newsletter FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_newsletter TO service_role;
REVOKE ALL ON TABLE public.lr_newsletter_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_newsletter_deliveries TO service_role;
REVOKE ALL ON TABLE public.lr_newsletter_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_newsletter_sends TO service_role;
REVOKE ALL ON TABLE public.lr_outreach_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_outreach_links TO service_role;
REVOKE ALL ON TABLE public.lr_partners FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_partners TO service_role;
REVOKE ALL ON TABLE public.lr_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_records TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_records TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_records TO authenticated;
REVOKE ALL ON TABLE public.lr_reminder_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_reminder_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_reminder_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_reminder_log TO authenticated;
REVOKE ALL ON TABLE public.lr_review_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_review_requests TO service_role;
REVOKE ALL ON TABLE public.lr_security_blocks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_security_blocks TO service_role;
REVOKE ALL ON TABLE public.lr_security_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_security_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_security_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_security_log TO authenticated;
REVOKE ALL ON TABLE public.lr_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_settings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_settings TO authenticated;
REVOKE ALL ON TABLE public.lr_support_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_support_tickets TO service_role;
REVOKE ALL ON TABLE public.lr_suppression FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_suppression TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_suppression TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_suppression TO authenticated;
REVOKE ALL ON TABLE public.lr_user_data FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_user_data TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_user_data TO authenticated;
REVOKE ALL ON TABLE public.lr_verify_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_verify_views TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_verify_views TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_verify_views TO authenticated;
REVOKE ALL ON TABLE public.lr_webhook_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_webhook_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_webhook_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lr_webhook_log TO authenticated;
REVOKE ALL ON TABLE public.lr_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lr_counters TO service_role;

-- ===================== 5_storage.sql =====================
-- Storage buckets (all private). Bucket ids are kept exactly as the ported code references them
-- (lib/supabase/admin.ts, lib/storage/exports.ts, lib/b2b/invoice.tsx still use the 'immo-' ids).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('api-private', 'api-private', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png','image/tiff']),
  ('b2b-logos', 'b2b-logos', false, 1048576, ARRAY['image/png','image/jpeg']),
  ('b2b-verify', 'b2b-verify', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png']),
  ('bank-ready-pdf', 'bank-ready-pdf', false, 52428800, ARRAY['application/pdf']),
  ('creator-assets', 'creator-assets', false, 524288000, ARRAY['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','application/pdf','application/zip']),
  ('creator-documents', 'creator-documents', false, 10485760, ARRAY['application/pdf']),
  ('immo-exports', 'immo-exports', false, 209715200, ARRAY['application/zip','application/pdf']),
  ('immo-invoices', 'immo-invoices', false, 5242880, ARRAY['application/pdf']),
  ('immo-private', 'immo-private', false, 52428800, ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/tiff']),
  ('mail', 'mail', false, 26214400, NULL),
  ('support-shots', 'support-shots', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- storage.objects policies (same as the source project)
DO $do$
DECLARE p record;
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('bank_ready_pdf_insert', $q$CREATE POLICY bank_ready_pdf_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'bank-ready-pdf'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.jwt() ->> 'sub'::text)))))$q$),
    ('bank_ready_pdf_select', $q$CREATE POLICY bank_ready_pdf_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'bank-ready-pdf'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.jwt() ->> 'sub'::text)))))$q$),
    ('lr_private_delete', $q$CREATE POLICY lr_private_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text)))$q$),
    ('lr_private_no_client_insert', $q$CREATE POLICY lr_private_no_client_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id <> 'immo-private'::text))$q$),
    ('lr_private_no_client_update', $q$CREATE POLICY lr_private_no_client_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING ((bucket_id <> 'immo-private'::text)) WITH CHECK ((bucket_id <> 'immo-private'::text))$q$),
    ('lr_private_read', $q$CREATE POLICY lr_private_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text)))$q$),
    ('lr_private_update', $q$CREATE POLICY lr_private_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text))) WITH CHECK (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text)))$q$),
    ('lr_private_upload', $q$CREATE POLICY lr_private_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'immo-private'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text)))$q$)
  ) AS v(name, ddl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = p.name) THEN
      EXECUTE p.ddl;
    END IF;
  END LOOP;
END $do$;

-- ===================== 6_seeds.sql =====================
-- Non-personal configuration seeds.
-- Creator Hub defaults (pure flags/defaults).
INSERT INTO public.lr_settings (key, value, updated_by) VALUES
  ('creator_attribution_window_days', '90'::jsonb, 'seed:base-schema'),
  ('creator_auto_close', 'false'::jsonb, 'seed:base-schema'),
  ('creator_bank_change_requires_review', 'true'::jsonb, 'seed:base-schema'),
  ('creator_close_delay_days', '15'::jsonb, 'seed:base-schema'),
  ('creator_invoice_reminder_days', '7'::jsonb, 'seed:base-schema'),
  ('creator_payout_four_eyes', 'false'::jsonb, 'seed:base-schema')
ON CONFLICT (key) DO NOTHING;

-- Default commission rule: 20 % of net revenue (amounts are in USD cents; no fixed amount).
INSERT INTO public.lr_creator_commission_rules (version, creator_id, campaign_slug, kind, percent_bps, fixed_cents, tiers, note, created_by)
SELECT 1, NULL, NULL, 'PERCENT', 2000, 0, '[]'::jsonb, 'Default rule (USD): 20 % of net revenue', 'seed:base-schema'
WHERE NOT EXISTS (SELECT 1 FROM public.lr_creator_commission_rules);

-- Creator agreement: English placeholder, NOT published (must be reviewed before publishing).
INSERT INTO public.lr_creator_agreements (version, title, body, body_sha256, is_draft, published_at)
SELECT '2026-10', 'US Creator Partner Agreement – draft, to be reviewed', b, encode(extensions.digest(convert_to(b, 'UTF8'), 'sha256'), 'hex'), true, NULL
FROM (SELECT 'US Creator Partner Agreement – draft, to be reviewed. This placeholder replaces the German source agreement and must be reviewed by counsel before publication.'::text AS b) x
WHERE NOT EXISTS (SELECT 1 FROM public.lr_creator_agreements);


-- ===================== 3a: RLS early + US document categories (applied as leaserun_base_3a_enable_rls_and_us_categories) =====================
-- US document categories (superset: German keys stay allowed). Requested by coordinator 2026-10-27.
ALTER TABLE public.lr_documents DROP CONSTRAINT IF EXISTS lr_documents_category_chk;
ALTER TABLE public.lr_documents ADD CONSTRAINT lr_documents_category_chk CHECK ((category IS NULL) OR (category = ANY (ARRAY['objekt'::text,'miete'::text,'weg'::text,'grundbuch'::text,'technik'::text,'finanzen'::text,'steuer'::text,'id'::text,'pay_stubs'::text,'w2'::text,'form_1099'::text,'tax_returns'::text,'bank_statements'::text,'purchase_agreement'::text,'leases'::text,'insurance'::text,'llc'::text,'appraisal'::text,'inspection'::text,'hoa'::text,'title'::text,'other'::text])));
ALTER TABLE public.lr_document_requests DROP CONSTRAINT IF EXISTS lr_document_requests_category_check;
ALTER TABLE public.lr_document_requests ADD CONSTRAINT lr_document_requests_category_check CHECK (category = ANY (ARRAY['objekt'::text,'miete'::text,'weg'::text,'grundbuch'::text,'technik'::text,'finanzen'::text,'steuer'::text,'id'::text,'pay_stubs'::text,'w2'::text,'form_1099'::text,'tax_returns'::text,'bank_statements'::text,'purchase_agreement'::text,'leases'::text,'insurance'::text,'llc'::text,'appraisal'::text,'inspection'::text,'hoa'::text,'title'::text,'other'::text]));
-- Enable RLS on all new tables early (policies follow in a later part).
ALTER TABLE public.api_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_validation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_b2b_verification_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_pdf_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_pdf_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bank_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_pricing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_bank_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_socials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creator_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_data_room_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_data_room_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kaeufe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kreditmappe_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_kreditmappe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_newsletter_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_outreach_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_security_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_security_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_verify_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_webhook_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_counters ENABLE ROW LEVEL SECURITY;
