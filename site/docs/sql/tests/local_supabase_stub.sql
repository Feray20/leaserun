-- Minimaler Nachbau der Supabase-Umgebung für lokale Tests in einer leeren PostgreSQL-Datenbank (≥ 15).
-- NICHT auf Supabase ausführen – dort existiert all das bereits.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  status text not null, factor_type text not null, friendly_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;

-- Bestehende Projektobjekte, auf die die Migration aufbaut (Definition wie in Produktion):
create table public.lr_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by text);
create function public.lr_touch_updated_at() returns trigger language plpgsql set search_path to 'public' as $$ begin new.updated_at = now(); return new; end; $$;
create function public.lr_mfa_ok() returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
grant execute on function public.lr_mfa_ok() to anon, authenticated;

-- Für Phase 2: Reichweitenmessung und Storage-Buckets (vereinfacht)
create table public.lr_analytics (id bigserial primary key, ts timestamptz not null default now(), seg text not null default 'b2c', ev text not null, visitor text, path text, ref text, src text, med text, camp text, device text, browser text, os text, country text, plan text, region text, city text);
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table public.lr_counters (name text primary key, value bigint not null);
