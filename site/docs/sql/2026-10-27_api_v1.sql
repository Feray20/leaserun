-- LeaseRun API v1: Schlüssel, Mandanten-Richtlinien, Fälle, Prüfläufe, Unterlagen, Berichte, Webhooks,
-- Anfrageprotokoll, Idempotenz, Rate-Limit und manipulationsresistentes Audit-Protokoll.
-- Mandant = Unternehmenskonto (lr_b2b_accounts.id). Alle Tabellen: RLS aktiv, keine Richtlinien für
-- anon/authenticated – Zugriff ausschließlich serverseitig über den Service-Schlüssel.
-- Rückbau: 2026-10-27_api_v1_rollback.sql

-- ---------- Richtlinie je Mandant (Admin-Schalter) ----------
create table if not exists public.api_tenant_policies (
  tenant_id uuid primary key references public.lr_b2b_accounts(id) on delete cascade,
  enabled boolean not null default false,              -- API vom Admin freigeschaltet
  live_enabled boolean not null default false,         -- Live-Schlüssel erlaubt (sonst nur Testumgebung)
  rate_limit integer check (rate_limit is null or rate_limit between 1 and 100000),        -- Anfragen/Minute (null = Tarif)
  burst_limit integer check (burst_limit is null or burst_limit between 1 and 100000),     -- Anfragen/10 s (null = Tarif)
  max_document_bytes integer check (max_document_bytes is null or max_document_bytes between 1024 and 4194304),
  webhooks_allowed boolean,                             -- null = Tarif
  white_label_allowed boolean,                          -- null = Tarif
  routing_enabled boolean not null default false,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- ---------- API-Schlüssel (nur Hash gespeichert) ----------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null unique check (key_prefix ~ '^(test|live)_[A-Za-z0-9]{8}$'),
  key_hash text not null unique check (char_length(key_hash) = 64),
  scopes text[] not null default '{}',
  allowed_ips text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  disabled_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  rotated_from uuid references public.api_keys(id) on delete set null,
  last_used_at timestamptz
);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id, created_at desc);

-- ---------- Anfrageprotokoll (ohne Inhalte, ohne personenbezogene Daten) ----------
create table if not exists public.api_requests (
  id bigint generated always as identity primary key,
  request_id text not null,
  tenant_id uuid references public.lr_b2b_accounts(id) on delete cascade,
  key_id uuid references public.api_keys(id) on delete set null,
  key_prefix text,
  environment text check (environment in ('test', 'live')),
  method text not null,
  route text not null,          -- Muster, z. B. /api/v1/cases/{id}
  status integer not null,
  duration_ms integer not null,
  response_bytes integer,
  error_code text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists api_requests_tenant_idx on public.api_requests (tenant_id, created_at desc);
create index if not exists api_requests_time_idx on public.api_requests (created_at desc);
create index if not exists api_requests_key_idx on public.api_requests (key_id, created_at desc);

-- ---------- Rate-Limit-Zähler (feste Fenster, atomar) ----------
create table if not exists public.api_rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.api_rate_take(p_bucket text, p_window_seconds integer, p_limit integer)
returns table (used integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
begin
  insert into public.api_rate_counters as c (bucket, window_start, n) values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set n = c.n + 1
  returning c.n into used;
  reset_at := ws + make_interval(secs => p_window_seconds);
  return next;
end $$;

-- ---------- Idempotenz ----------
create table if not exists public.api_idempotency_keys (
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  idem_key text not null check (char_length(idem_key) between 8 and 120),
  method text not null,
  route text not null,
  request_hash text not null,
  status integer,               -- null = in Bearbeitung
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, environment, idem_key)
);
create index if not exists api_idem_time_idx on public.api_idempotency_keys (created_at);

-- ---------- Fälle ----------
create table if not exists public.api_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  external_reference text check (external_reference is null or char_length(external_reference) <= 120),
  status text not null default 'open' check (status in ('open', 'action_required', 'completed')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists api_cases_tenant_idx on public.api_cases (tenant_id, environment, created_at desc, id desc) where deleted_at is null;
create unique index if not exists api_cases_extref_uidx on public.api_cases (tenant_id, environment, external_reference) where external_reference is not null and deleted_at is null;

-- ---------- Prüfläufe (Vorprüfung) ----------
create table if not exists public.api_validation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  case_id uuid not null references public.api_cases(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  completeness_score integer check (completeness_score between 0 and 100),
  result jsonb,
  engine_version text not null default '1.0',
  duration_ms integer,
  created_at timestamptz not null default now(),
  evaluated_at timestamptz
);
create index if not exists api_validation_case_idx on public.api_validation_runs (tenant_id, case_id, created_at desc);

-- ---------- Unterlagen ----------
create table if not exists public.api_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  case_id uuid not null references public.api_cases(id) on delete cascade,
  type text not null,
  filename text not null check (char_length(filename) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/tiff')),
  size integer not null check (size > 0),
  sha256 text not null check (char_length(sha256) = 64),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'classified', 'verified', 'rejected', 'failed')),
  classification text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'formally_verified', 'rejected')),
  malware_scan text not null default 'not_configured' check (malware_scan in ('not_configured', 'clean', 'infected', 'error')),
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists api_documents_case_idx on public.api_documents (tenant_id, case_id, uploaded_at desc, id desc) where deleted_at is null;

-- ---------- Berichte ----------
create table if not exists public.api_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  case_id uuid not null references public.api_cases(id) on delete cascade,
  validation_id uuid references public.api_validation_runs(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  branding text not null check (branding in ('leaserun', 'white_label')),
  storage_path text,
  sha256 text,
  size integer,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists api_reports_case_idx on public.api_reports (tenant_id, case_id, created_at desc, id desc);
create index if not exists api_reports_queue_idx on public.api_reports (status, created_at) where status in ('queued', 'processing');

-- ---------- Webhooks ----------
create table if not exists public.api_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  description text check (description is null or char_length(description) <= 200),
  secret_enc text not null,          -- AES-256-GCM (API_ENCRYPTION_KEY); wird zum Signieren benötigt
  secret_prefix text not null,
  events text[] not null check (cardinality(events) > 0),
  enabled boolean not null default true,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_delivery_at timestamptz
);
create index if not exists api_webhooks_tenant_idx on public.api_webhook_endpoints (tenant_id, environment, created_at desc);

create table if not exists public.api_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.lr_b2b_accounts(id) on delete cascade,
  environment text not null check (environment in ('test', 'live')),
  endpoint_id uuid not null references public.api_webhook_endpoints(id) on delete cascade,
  event text not null,
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'retrying', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  response_excerpt text,
  duration_ms integer,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (endpoint_id, dedupe_key)
);
create index if not exists api_deliveries_due_idx on public.api_webhook_deliveries (next_attempt_at) where status in ('pending', 'retrying');
create index if not exists api_deliveries_tenant_idx on public.api_webhook_deliveries (tenant_id, created_at desc);

-- ---------- Audit-Protokoll (Hash-Kette, nur anhängen) ----------
create table if not exists public.api_audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.lr_b2b_accounts(id) on delete set null,
  environment text,
  actor text not null,
  action text not null,
  resource_type text,
  resource_id text,
  request_id text,
  result text not null default 'success' check (result in ('success', 'failure')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  prev_hash text,
  hash text not null default ''
);
create index if not exists api_audit_tenant_idx on public.api_audit_events (tenant_id, created_at desc);

create or replace function public.api_audit_chain() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
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
end $$;
create or replace trigger api_audit_chain_trg before insert on public.api_audit_events for each row execute function public.api_audit_chain();

create or replace function public.api_audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Mandant gelöscht: nur das Nullsetzen der Mandanten-ID (Fremdschlüssel) ist erlaubt.
  if tg_op = 'UPDATE' and new.tenant_id is null and old.tenant_id is not null
     and (new.action, new.hash, new.actor, new.created_at) is not distinct from (old.action, old.hash, old.actor, old.created_at) then
    return new;
  end if;
  raise exception 'api_audit_events ist unveränderlich';
end $$;
create or replace trigger api_audit_immutable_trg before update or delete on public.api_audit_events for each row execute function public.api_audit_immutable();

-- ---------- Nutzungsauswertung ----------
create or replace function public.api_usage_series(p_tenant uuid, p_env text, p_from timestamptz, p_bucket text)
returns table (bucket timestamptz, requests bigint, errors_4xx bigint, errors_5xx bigint, rate_limited bigint, avg_ms numeric, p95_ms numeric, p99_ms numeric)
language sql stable security definer set search_path = public as $$
  select date_trunc(p_bucket, created_at) as bucket,
    count(*), count(*) filter (where status between 400 and 499), count(*) filter (where status >= 500),
    count(*) filter (where status = 429), round(avg(duration_ms)::numeric, 1),
    round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 1),
    round(percentile_cont(0.99) within group (order by duration_ms)::numeric, 1)
  from public.api_requests
  where created_at >= p_from and (p_tenant is null or tenant_id = p_tenant) and (p_env is null or environment = p_env)
  group by 1 order by 1
$$;

-- ---------- RLS: nur serverseitig ----------
do $$ declare t text; begin
  foreach t in array array['api_tenant_policies','api_keys','api_requests','api_rate_counters','api_idempotency_keys','api_cases',
    'api_validation_runs','api_documents','api_reports','api_webhook_endpoints','api_webhook_deliveries','api_audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function public.api_rate_take(text, integer, integer) from public, anon, authenticated;
revoke all on function public.api_usage_series(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.api_audit_chain() from public, anon, authenticated;
grant execute on function public.api_rate_take(text, integer, integer) to service_role;
grant execute on function public.api_usage_series(uuid, text, timestamptz, text) to service_role;

-- ---------- Privater Speicher für Unterlagen und Berichte ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('api-private', 'api-private', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])
on conflict (id) do update set public = false;
