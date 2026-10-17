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
