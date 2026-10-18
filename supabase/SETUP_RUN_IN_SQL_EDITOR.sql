-- LeaseRun: complete database setup. Paste into Supabase > SQL Editor (project leaserun) and click Run. Safe to run more than once.
-- LeaseRun investor software (US port of ImmoAdv): accounts, financial profile,
-- saved properties and plan entitlements. Every table is private to its owner via RLS.

-- Plan entitlements: readable by the owner, writable only by the service role
-- (Stripe webhook / admin). Users can never upgrade themselves.
create table if not exists public.entitlements (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  plan        text not null default 'free' check (plan in ('free','buyer_pass','pro')),
  pass_until  timestamptz,
  loan_packages_left int not null default 0 check (loan_packages_left >= 0),
  updated_at  timestamptz not null default now()
);
comment on table public.entitlements is 'Plan per user. Written by service role only (billing).';

-- Investor / borrower profile used for affordability, reserves, tax and the loan package.
create table if not exists public.financial_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  full_name        text check (char_length(full_name) <= 120),
  mode             text not null default 'beginner' check (mode in ('beginner','pro')),
  state            text check (char_length(state) <= 2),
  annual_income    numeric check (annual_income >= 0 and annual_income < 1e9),
  monthly_debts    numeric check (monthly_debts >= 0 and monthly_debts < 1e8),
  liquid_reserves  numeric check (liquid_reserves >= 0 and liquid_reserves < 1e10),
  credit_band      text check (credit_band in ('760+','720-759','680-719','640-679','<640')),
  filing_status    text check (filing_status in ('single','married_joint','married_separate','head')),
  marginal_rate    numeric check (marginal_rate >= 0 and marginal_rate <= 50),
  doors_owned      int check (doors_owned >= 0 and doors_owned < 100000),
  buy_as           text check (buy_as in ('individual','llc')),
  updated_at       timestamptz not null default now()
);

-- Saved properties. Inputs are stored as JSON (validated in the client engine,
-- size-capped here) so the US model can evolve without migrations.
create table if not exists public.properties (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  status      text not null default 'analyzing' check (status in ('analyzing','offer','under_contract','owned','passed')),
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 32000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists properties_user_idx on public.properties(user_id, updated_at desc);

alter table public.entitlements       enable row level security;
alter table public.financial_profiles enable row level security;
alter table public.properties         enable row level security;

drop policy if exists "own entitlement read" on public.entitlements;
create policy "own entitlement read" on public.entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own profile" on public.financial_profiles;
create policy "own profile" on public.financial_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own properties" on public.properties;
create policy "own properties" on public.properties
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Free plan: max 2 saved properties, enforced server-side.
create or replace function public.enforce_property_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_until timestamptz;
  v_count int;
begin
  select plan, pass_until into v_plan, v_until from public.entitlements where user_id = new.user_id;
  if v_plan = 'pro' or (v_plan = 'buyer_pass' and v_until > now()) then
    return new;
  end if;
  select count(*) into v_count from public.properties where user_id = new.user_id;
  if v_count >= 2 then
    raise exception 'FREE_LIMIT: The free plan includes 2 saved properties.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists properties_limit on public.properties;
create trigger properties_limit before insert on public.properties
  for each row execute function public.enforce_property_limit();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists properties_touch on public.properties;
create trigger properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.financial_profiles;
create trigger profiles_touch before update on public.financial_profiles
  for each row execute function public.touch_updated_at();

-- New accounts get a free entitlement row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.entitlements(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_lr on auth.users;
create trigger on_auth_user_created_lr after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.enforce_property_limit() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant select on public.entitlements to authenticated;
grant select, insert, update, delete on public.financial_profiles to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
revoke all on public.entitlements, public.financial_profiles, public.properties from anon;

-- LeaseRun for Business: company profile, client files, client-linked properties.
-- Requires 20261017120000_investor_app.sql.

alter table public.entitlements drop constraint if exists entitlements_plan_check;
alter table public.entitlements add constraint entitlements_plan_check
  check (plan in ('free','buyer_pass','pro','b2b_basic','b2b_pro','b2b_enterprise'));

create table if not exists public.business_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  company      text check (char_length(company) <= 120),
  role         text check (role in ('agent','loan_officer','property_manager','advisor','other')),
  license_no   text check (char_length(license_no) <= 60),
  phone        text check (char_length(phone) <= 40),
  email        text check (char_length(email) <= 254),
  website      text check (char_length(website) <= 200),
  brand_color  text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  disclaimer   text check (char_length(disclaimer) <= 600),
  updated_at   timestamptz not null default now()
);

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  email       text check (char_length(email) <= 254),
  phone       text check (char_length(phone) <= 40),
  stage       text not null default 'new' check (stage in ('new','qualifying','searching','under_contract','closed','inactive')),
  notes       text check (char_length(notes) <= 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_user_idx on public.clients(user_id, updated_at desc);

alter table public.properties add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists properties_client_idx on public.properties(client_id);

alter table public.business_profiles enable row level security;
alter table public.clients enable row level security;

drop policy if exists "own business profile" on public.business_profiles;
create policy "own business profile" on public.business_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own clients" on public.clients;
create policy "own clients" on public.clients for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A property may only point at the caller's own client.
drop policy if exists "own properties" on public.properties;
create policy "own properties" on public.properties for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (client_id is null or exists (
    select 1 from public.clients c where c.id = client_id and c.user_id = (select auth.uid()))));

-- Client files need a business plan; Basic is limited to 25 active clients.
create or replace function public.enforce_client_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_count int;
begin
  select plan into v_plan from public.entitlements where user_id = new.user_id;
  if v_plan is null or v_plan not like 'b2b_%' then
    raise exception 'B2B_REQUIRED: Client files are part of LeaseRun for Business.' using errcode = 'P0001';
  end if;
  if v_plan = 'b2b_basic' then
    select count(*) into v_count from public.clients where user_id = new.user_id and stage <> 'inactive';
    if v_count >= 25 then
      raise exception 'B2B_LIMIT: Business Basic includes 25 active client files.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists clients_limit on public.clients;
create trigger clients_limit before insert on public.clients for each row execute function public.enforce_client_limit();
revoke execute on function public.enforce_client_limit() from public, anon, authenticated;

-- Business plans include unlimited properties.
create or replace function public.enforce_property_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_until timestamptz; v_count int;
begin
  select plan, pass_until into v_plan, v_until from public.entitlements where user_id = new.user_id;
  if v_plan in ('pro','b2b_basic','b2b_pro','b2b_enterprise') or (v_plan = 'buyer_pass' and v_until > now()) then
    return new;
  end if;
  select count(*) into v_count from public.properties where user_id = new.user_id;
  if v_count >= 2 then
    raise exception 'FREE_LIMIT: The free plan includes 2 saved properties.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_property_limit() from public, anon, authenticated;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists business_touch on public.business_profiles;
create trigger business_touch before update on public.business_profiles for each row execute function public.touch_updated_at();

grant select, insert, update, delete on public.business_profiles, public.clients to authenticated;
revoke all on public.business_profiles, public.clients from anon;

-- LeaseRun billing: Stripe webhook (Vercel function /api/stripe-webhook) grants plans
-- through a single SECURITY DEFINER function protected by a shared secret.
-- Only the SHA-256 hash of the secret is stored; the secret lives in the Vercel env var LR_GRANT_SECRET.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (key text primary key, value text not null);
create table if not exists private.stripe_events (id text primary key, type text, received_at timestamptz not null default now());

alter table public.entitlements add column if not exists stripe_customer text;
alter table public.entitlements add column if not exists stripe_subscription text;
alter table public.entitlements add column if not exists unlocked_properties uuid[] not null default '{}';
create index if not exists entitlements_sub_idx on public.entitlements(stripe_subscription);

-- p_action: 'checkout' (one-time or new subscription) or 'cancel' (subscription ended)
create or replace function public.lr_grant(p_secret text, p_event text, p_action text, p_user uuid, p_plan text,
                                           p_property uuid default null, p_customer text default null, p_subscription text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_rank_new int; v_rank_old int; v_old text; v_until timestamptz;
begin
  select value into v_hash from private.settings where key = 'grant_secret_sha256';
  if v_hash is null or encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  begin
    insert into private.stripe_events(id, type) values (p_event, p_action);
  exception when unique_violation then
    return 'duplicate';
  end;

  if p_action = 'cancel' then
    update public.entitlements set plan = case when pass_until > now() then 'buyer_pass' else 'free' end,
           stripe_subscription = null, updated_at = now()
     where stripe_subscription = p_subscription;
    return 'cancelled';
  end if;

  if p_user is null then raise exception 'missing user'; end if;
  insert into public.entitlements(user_id) values (p_user) on conflict do nothing;
  select plan, pass_until into v_old, v_until from public.entitlements where user_id = p_user;

  if p_plan = 'loan_package' then
    update public.entitlements
       set unlocked_properties = case when p_property is null or p_property = any(unlocked_properties) then unlocked_properties else unlocked_properties || p_property end,
           loan_packages_left = case when p_property is null then loan_packages_left + 1 else loan_packages_left end,
           stripe_customer = coalesce(p_customer, stripe_customer), updated_at = now()
     where user_id = p_user;
    return 'loan_package';
  end if;

  v_rank_new := case p_plan when 'buyer_pass' then 1 when 'pro' then 2 when 'b2b_basic' then 3 when 'b2b_pro' then 4 when 'b2b_enterprise' then 5 else 0 end;
  v_rank_old := case v_old when 'buyer_pass' then 1 when 'pro' then 2 when 'b2b_basic' then 3 when 'b2b_pro' then 4 when 'b2b_enterprise' then 5 else 0 end;
  if v_rank_new = 0 then raise exception 'unknown plan'; end if;

  if p_plan = 'buyer_pass' then
    update public.entitlements
       set pass_until = greatest(coalesce(pass_until, now()), now()) + interval '90 days',
           plan = case when v_rank_old > 1 then plan else 'buyer_pass' end,
           stripe_customer = coalesce(p_customer, stripe_customer), updated_at = now()
     where user_id = p_user;
  else
    update public.entitlements
       set plan = p_plan, stripe_customer = coalesce(p_customer, stripe_customer),
           stripe_subscription = coalesce(p_subscription, stripe_subscription), updated_at = now()
     where user_id = p_user;
  end if;
  return p_plan;
end $$;

revoke execute on function public.lr_grant(text, text, text, uuid, text, uuid, text, text) from public, authenticated;
grant execute on function public.lr_grant(text, text, text, uuid, text, uuid, text, text) to anon;
