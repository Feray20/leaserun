-- LeaseRun Card: Karten, Limits, Transaktionen, Anträge, Audit, Preisverzeichnis.
-- Geldbeträge ausschließlich in Cent (bigint). Zeiten in UTC; Abrechnungsmonat nach Europe/Berlin.
-- Schreiben nur über den Server (Service-Rolle) bzw. die SQL-Funktionen; Nutzer lesen nur eigene Daten (RLS).

create table if not exists public.lr_card_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_type text not null check (product_type in ('debit','charge')),
  design text not null check (design in ('classic-black','platinum','minimal-white')),
  status text not null default 'PENDING' check (status in ('DRAFT','PENDING','APPROVED','REJECTED','WITHDRAWN')),
  kyc_status text not null default 'NOT_STARTED' check (kyc_status in ('NOT_STARTED','STARTED','KYC_PENDING','KYC_VERIFIED','KYC_FAILED')),
  provider_status text not null default 'NOT_CONFIGURED' check (provider_status in ('NOT_CONFIGURED','PROVIDER_PENDING','PROVIDER_ERROR','READY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lr_card_applications_user on public.lr_card_applications (user_id);

create table if not exists public.lr_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('debit','charge','business')),
  design text not null check (design in ('classic-black','platinum','minimal-white')),
  status text not null default 'PENDING' check (status in ('ACTIVE','PENDING','FROZEN','BLOCKED')),
  last4 text null check (last4 is null or last4 ~ '^[0-9]{4}$'),
  provider text null check (provider is null or provider in ('stripe')),
  provider_ref text null unique,
  cardholder_ref text null,
  stripe_account text null check (stripe_account is null or stripe_account ~ '^acct_[A-Za-z0-9]+$'),
  b2b_account_id uuid null references public.lr_b2b_accounts(id) on delete cascade,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lr_cards_user on public.lr_cards (user_id);
create index if not exists lr_cards_b2b on public.lr_cards (b2b_account_id) where b2b_account_id is not null;

create table if not exists public.lr_card_limits (
  card_id uuid primary key references public.lr_cards(id) on delete cascade,
  monthly_limit_cents bigint not null check (monthly_limit_cents >= 0),
  settled_cents bigint not null default 0 check (settled_cents >= 0),
  reserved_cents bigint not null default 0 check (reserved_cents >= 0),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  security_deposit_cents bigint not null default 0 check (security_deposit_cents >= 0),
  refunds_release_limit boolean not null default true,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.lr_card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.lr_cards(id) on delete cascade,
  kind text not null check (kind in ('authorization','refund')),
  parent_id uuid null references public.lr_card_transactions(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  status text not null check (status in ('AUTHORIZED','SETTLED','RELEASED','REFUNDED','DECLINED_LIMIT_EXCEEDED','DECLINED_CARD_FROZEN','DECLINED_CARD_INACTIVE')),
  merchant text null check (merchant is null or char_length(merchant) <= 120),
  category text null check (category is null or char_length(category) <= 60),
  available_before_cents bigint not null,
  available_after_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, idempotency_key)
);
create index if not exists lr_card_tx_card_created on public.lr_card_transactions (card_id, created_at desc);

create table if not exists public.lr_card_audit (
  id bigint generated always as identity primary key,
  card_id uuid null references public.lr_cards(id) on delete cascade,
  user_id uuid null,
  actor text not null,
  action text not null,
  old_value jsonb null,
  new_value jsonb null,
  ip_hash text null,
  request_id text null,
  created_at timestamptz not null default now()
);
create index if not exists lr_card_audit_card on public.lr_card_audit (card_id, created_at desc);

-- Preis- und Leistungsverzeichnis: Versionen werden nie überschrieben, nur neu veröffentlicht.
create table if not exists public.lr_card_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  document_id text not null,
  version text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  effective_from date null,
  document_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, version)
);
create table if not exists public.lr_card_pricing_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.lr_card_pricing_versions(id) on delete cascade,
  chapter smallint not null check (chapter between 1 and 30),
  position smallint not null default 0,
  product text not null check (product in ('all','debit','charge')),
  name text not null check (char_length(name) <= 160),
  amount_cents bigint null check (amount_cents is null or amount_cents >= 0),
  currency text not null default 'EUR',
  unit text null check (unit is null or char_length(unit) <= 60),
  note text null check (note is null or char_length(note) <= 600),
  active boolean not null default true
);
create index if not exists lr_card_pricing_items_version on public.lr_card_pricing_items (version_id, chapter, position);

alter table public.lr_card_applications enable row level security;
alter table public.lr_cards enable row level security;
alter table public.lr_card_limits enable row level security;
alter table public.lr_card_transactions enable row level security;
alter table public.lr_card_audit enable row level security;
alter table public.lr_card_pricing_versions enable row level security;
alter table public.lr_card_pricing_items enable row level security;
revoke all on public.lr_card_applications, public.lr_cards, public.lr_card_limits, public.lr_card_transactions, public.lr_card_audit, public.lr_card_pricing_versions, public.lr_card_pricing_items from anon, authenticated;
grant select on public.lr_card_applications, public.lr_cards, public.lr_card_limits, public.lr_card_transactions to authenticated;

drop policy if exists card_apps_own on public.lr_card_applications;
create policy card_apps_own on public.lr_card_applications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists cards_own on public.lr_cards;
create policy cards_own on public.lr_cards for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists card_limits_own on public.lr_card_limits;
create policy card_limits_own on public.lr_card_limits for select to authenticated using (exists (select 1 from public.lr_cards c where c.id = card_id and c.user_id = (select auth.uid())));
drop policy if exists card_tx_own on public.lr_card_transactions;
create policy card_tx_own on public.lr_card_transactions for select to authenticated using (exists (select 1 from public.lr_cards c where c.id = card_id and c.user_id = (select auth.uid())));

-- Beginn des nächsten Abrechnungsmonats (Europe/Berlin) als UTC-Zeitpunkt.
create or replace function public.lr_card_next_reset(p_at timestamptz default now()) returns timestamptz
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_at at time zone 'Europe/Berlin') + interval '1 month') at time zone 'Europe/Berlin';
$$;

-- Verfügbares Limit, nie negativ.
create or replace function public.lr_card_available(l public.lr_card_limits) returns bigint
language sql immutable set search_path = '' as $$
  select greatest(0, l.monthly_limit_cents - l.settled_cents - l.reserved_cents + case when l.refunds_release_limit then l.refunded_cents else 0 end);
$$;

-- Autorisierung mit hartem Limit: Sperre auf der Limit-Zeile (FOR UPDATE) serialisiert parallele Anfragen,
-- Idempotenzschlüssel verhindert doppelte Belastung. Rückgabe: Status, Transaktion, verfügbar danach.
create or replace function public.lr_card_authorize(p_card uuid, p_amount bigint, p_key text, p_merchant text default null, p_category text default null)
returns table (status text, tx_id uuid, available_after_cents bigint)
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Buchung (Reservierung → abgerechnet) bzw. Freigabe (Reservierung verfällt).
create or replace function public.lr_card_settle(p_tx uuid, p_release boolean default false)
returns table (status text, available_after_cents bigint)
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Erstattung auf eine abgerechnete Zahlung (höchstens bis zum ursprünglichen Betrag), idempotent.
create or replace function public.lr_card_refund(p_tx uuid, p_amount bigint, p_key text)
returns table (status text, tx_id uuid, available_after_cents bigint)
language plpgsql security definer set search_path = '' as $$
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
end $$;

revoke all on function public.lr_card_authorize(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.lr_card_settle(uuid, boolean) from public, anon, authenticated;
revoke all on function public.lr_card_refund(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.lr_card_authorize(uuid, bigint, text, text, text) to service_role;
grant execute on function public.lr_card_settle(uuid, boolean) to service_role;
grant execute on function public.lr_card_refund(uuid, bigint, text) to service_role;
