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
