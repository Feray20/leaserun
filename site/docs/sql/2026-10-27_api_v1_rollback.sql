-- Rückbau LeaseRun API v1 (löscht alle API-Daten unwiderruflich; vorher exportieren).
drop trigger if exists api_audit_immutable_trg on public.api_audit_events;
drop table if exists public.api_webhook_deliveries, public.api_webhook_endpoints, public.api_reports, public.api_documents,
  public.api_validation_runs, public.api_cases, public.api_idempotency_keys, public.api_rate_counters, public.api_requests,
  public.api_keys, public.api_tenant_policies, public.api_audit_events cascade;
drop function if exists public.api_rate_take(text, integer, integer);
drop function if exists public.api_usage_series(uuid, text, timestamptz, text);
drop function if exists public.api_audit_chain();
drop function if exists public.api_audit_immutable();
-- Speicher-Bucket „api-private“ erst nach Leeren im Supabase-Dashboard löschen.
