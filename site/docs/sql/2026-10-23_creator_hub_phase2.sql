-- LeaseRun Creator Hub – Phase 2: Kampagnen, Asset Library, Community-Vorteil, Creator Studio (Content), Attribution, Conversions.
-- Voraussetzung: 2026-10-22_creator_hub.sql. Idempotent. Rückbau: 2026-10-23_creator_hub_phase2_rollback.sql
--
-- Attribution (datensparsam, ohne Cookies – wie die bestehende Reichweitenmessung):
--   * Besuche: vorhandene Tabelle lr_analytics (Quelle „partner<code>“, Kampagne aus utm_campaign).
--   * Registrierung: eine Zuordnung je Kundenkonto (erster Creator gewinnt), angelegt bei der Registrierung.
--   * Kauf: eine Conversion je bezahlter Stripe-Checkout-Sitzung. Ein eingelöster Creator-Vorteilscode hat Vorrang
--     vor dem Link. Eigenkäufe des Creators werden nie zugeordnet. Erstattungen setzen die Conversion auf REVERSED.
--   * Creator sehen nur Summen – nie, welche Kunden sich registriert oder gekauft haben.

begin;

-- ---------------------------------------------------------------------------
-- Kampagnen
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 3 and 120),
  summary text check (summary is null or char_length(summary) <= 600),
  brief text check (brief is null or char_length(brief) <= 8000),
  dos text check (dos is null or char_length(dos) <= 4000),
  donts text check (donts is null or char_length(donts) <= 4000),
  target_path text not null default '/' check (target_path ~ '^/[A-Za-z0-9/_\-]*$' and char_length(target_path) <= 120),
  audience text not null default 'ALL' check (audience in ('ALL','SELECTED')),
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','PAUSED','ENDED')),
  starts_on date,
  ends_on date check (ends_on is null or starts_on is null or ends_on >= starts_on),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lr_creator_campaign_members (
  campaign_id uuid not null references public.lr_creator_campaigns(id) on delete cascade,
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  added_by text not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, creator_id)
);
create index if not exists lr_creator_campaign_members_creator_idx on public.lr_creator_campaign_members (creator_id);

-- Darf ein Creator eine Kampagne sehen? (aktive Kampagne, für alle oder ausdrücklich zugeordnet)
-- SECURITY DEFINER: wird in RLS-Policies der Kampagnen selbst verwendet (sonst Rekursion); liefert nur ja/nein.
create or replace function public.lr_creator_can_see_campaign(p_campaign uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.lr_creator_campaigns k
    where k.id = p_campaign and k.status = 'ACTIVE'
      and (k.audience = 'ALL' or exists (select 1 from public.lr_creator_campaign_members m where m.campaign_id = k.id and m.creator_id = p_creator))
  );
$$;

-- ---------------------------------------------------------------------------
-- Asset Library (Dateien im privaten Bucket „creator-assets“, Ausgabe nur über kurzlebige signierte Links)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.lr_creator_campaigns(id) on delete set null,
  title text not null check (char_length(title) between 2 and 140),
  description text check (description is null or char_length(description) <= 1000),
  kind text not null check (kind in ('image','video','document','logo','text')),
  storage_path text unique check (storage_path is null or storage_path ~ '^assets/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  mime text check (mime is null or char_length(mime) <= 100),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 524288000),
  text_body text check (text_body is null or char_length(text_body) <= 8000),
  usage_notes text check (usage_notes is null or char_length(usage_notes) <= 1000),
  active boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  check ((kind = 'text' and text_body is not null and storage_path is null) or (kind <> 'text' and storage_path is not null))
);
create index if not exists lr_creator_assets_campaign_idx on public.lr_creator_assets (campaign_id);

-- ---------------------------------------------------------------------------
-- Community-Vorteil (individueller Code je Creator; Einlösung über gleichnamigen Stripe-Aktionscode)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_benefits (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  campaign_id uuid references public.lr_creator_campaigns(id) on delete set null,
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  benefit text not null check (char_length(benefit) between 3 and 200),
  terms text check (terms is null or char_length(terms) <= 2000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lr_creator_benefits_creator_idx on public.lr_creator_benefits (creator_id);

-- ---------------------------------------------------------------------------
-- Creator Studio: veröffentlichte Inhalte (Link + Kennzeichnung), Prüfung durch LeaseRun
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_content (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  campaign_id uuid references public.lr_creator_campaigns(id) on delete set null,
  platform text not null check (platform in ('youtube','tiktok','instagram','x','linkedin','other')),
  url text not null check (char_length(url) <= 300 and url ~ '^https://'),
  title text check (title is null or char_length(title) <= 160),
  published_on date not null,
  ad_disclosure boolean not null,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED','APPROVED','CHANGES_REQUESTED')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (creator_id, url)
);
create index if not exists lr_creator_content_status_idx on public.lr_creator_content (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Attribution (Kundenkonto → Creator) und Conversions (bezahlter Kauf → Creator)
-- ---------------------------------------------------------------------------
create table if not exists public.lr_creator_attributions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creator_id uuid not null references public.lr_creators(id) on delete cascade,
  campaign_slug text check (campaign_slug is null or campaign_slug ~ '^[a-z0-9-]{3,40}$'),
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_attributions_creator_idx on public.lr_creator_attributions (creator_id, created_at);

create table if not exists public.lr_creator_conversions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.lr_creators(id) on delete restrict,
  -- Kunde nur als Verweis (für Erstattungen und Prüfung); wird nie an Creator ausgegeben. Bei Kontolöschung bleibt die
  -- Conversion für die Abrechnung erhalten, der Personenbezug entfällt.
  user_id uuid references auth.users(id) on delete set null,
  campaign_slug text check (campaign_slug is null or campaign_slug ~ '^[a-z0-9-]{3,40}$'),
  source text not null check (source in ('link','code')),
  benefit_id uuid references public.lr_creator_benefits(id) on delete set null,
  stripe_session_id text not null unique check (stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_payment_intent text check (stripe_payment_intent is null or stripe_payment_intent ~ '^pi_[A-Za-z0-9_]+$'),
  plan text check (plan is null or char_length(plan) <= 40),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  amount_net_cents bigint not null check (amount_net_cents >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','REVERSED')),
  occurred_at timestamptz not null,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lr_creator_conversions_creator_idx on public.lr_creator_conversions (creator_id, occurred_at);
create index if not exists lr_creator_conversions_pi_idx on public.lr_creator_conversions (stripe_payment_intent);

-- Beträge und Zuordnung einer Conversion sind unveränderbar; nur die Rücknahme (Erstattung) ist erlaubt.
create or replace function public.lr_creator_conversion_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Conversions werden nicht gelöscht.';
  end if;
  if new.creator_id is distinct from old.creator_id or new.source is distinct from old.source or new.stripe_session_id is distinct from old.stripe_session_id
     or new.amount_net_cents is distinct from old.amount_net_cents or new.currency is distinct from old.currency or new.occurred_at is distinct from old.occurred_at
     or new.campaign_slug is distinct from old.campaign_slug or new.created_at is distinct from old.created_at then
    raise exception 'Conversions sind unveränderbar.';
  end if;
  if old.status = 'REVERSED' and new.status <> 'REVERSED' then raise exception 'Rücknahme ist endgültig.'; end if;
  return new;
end $$;
drop trigger if exists lr_creator_conversion_guard_trg on public.lr_creator_conversions;
create trigger lr_creator_conversion_guard_trg before update or delete on public.lr_creator_conversions
  for each row execute function public.lr_creator_conversion_guard();

-- updated_at
drop trigger if exists lr_creator_campaigns_touch on public.lr_creator_campaigns;
create trigger lr_creator_campaigns_touch before update on public.lr_creator_campaigns for each row execute function public.lr_touch_updated_at();
drop trigger if exists lr_creator_benefits_touch on public.lr_creator_benefits;
create trigger lr_creator_benefits_touch before update on public.lr_creator_benefits for each row execute function public.lr_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Kennzahlen je Creator (nur Summen, keine Kundendaten). Nur für den Server.
-- Besuche: Seitenaufrufe aus lr_analytics mit Quelle „partner<code>“ (die Messschnittstelle entfernt den Doppelpunkt).
-- ---------------------------------------------------------------------------
create or replace function public.lr_creator_performance(p_creator uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path to '' as $$
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
$$;

-- Kampagnen-Kennzahlen über alle Creator (Admin: „Welche Kampagne funktioniert?“)
create or replace function public.lr_creator_campaign_stats(p_from timestamptz, p_to timestamptz)
returns table (campaign text, creators bigint, visits bigint, registrations bigint, conversions bigint, revenue_net_cents bigint)
language sql stable set search_path to '' as $$
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
$$;

revoke all on function public.lr_creator_performance(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.lr_creator_campaign_stats(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.lr_creator_can_see_campaign(uuid, uuid) from public, anon;
grant execute on function public.lr_creator_performance(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.lr_creator_campaign_stats(timestamptz, timestamptz) to service_role;
grant execute on function public.lr_creator_can_see_campaign(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit: Ereignisse der Phase 2 zulassen
-- ---------------------------------------------------------------------------
alter table public.lr_creator_audit drop constraint if exists lr_creator_audit_event_type_check;
alter table public.lr_creator_audit add constraint lr_creator_audit_event_type_check check (event_type in (
  'CREATOR_CREATED','APPLICATION_SUBMITTED','REVIEW_STARTED','CREATOR_APPROVED','CREATOR_INFO_REQUESTED','CREATOR_REJECTED',
  'CREATOR_SUSPENDED','CREATOR_REACTIVATED','AGREEMENT_ACCEPTED',
  'BANK_DATA_ADDED','BANK_DATA_CHANGED','BANK_DETAILS_VIEWED','BANK_DATA_VERIFIED',
  'ADMIN_ROLE_CHANGED','ACCESS_DENIED',
  'CAMPAIGN_CHANGED','CAMPAIGN_MEMBERS_CHANGED','ASSET_CHANGED','ASSET_DOWNLOADED','BENEFIT_CHANGED',
  'CONTENT_SUBMITTED','CONTENT_REVIEWED','CONVERSION_RECORDED','CONVERSION_REVERSED',
  'COMMISSION_CHANGED','INVOICE_CREATED','INVOICE_APPROVED','INVOICE_REJECTED','PAYOUT_CREATED','PAYOUT_APPROVED','PAYOUT_PAID'
));

-- ---------------------------------------------------------------------------
-- RLS: Standard gesperrt. Creator dürfen sichtbare Kampagnen/Assets sowie eigene Vorteile/Inhalte lesen.
-- Attributionen und Conversions (enthalten Kundenbezug): kein Client-Zugriff.
-- ---------------------------------------------------------------------------
alter table public.lr_creator_campaigns enable row level security;
alter table public.lr_creator_campaign_members enable row level security;
alter table public.lr_creator_assets enable row level security;
alter table public.lr_creator_benefits enable row level security;
alter table public.lr_creator_content enable row level security;
alter table public.lr_creator_attributions enable row level security;
alter table public.lr_creator_conversions enable row level security;

revoke all on public.lr_creator_campaigns, public.lr_creator_campaign_members, public.lr_creator_assets, public.lr_creator_benefits,
  public.lr_creator_content, public.lr_creator_attributions, public.lr_creator_conversions from anon, authenticated;
grant select on public.lr_creator_campaigns, public.lr_creator_assets, public.lr_creator_benefits, public.lr_creator_content to authenticated;

drop policy if exists creator_campaigns_select_visible on public.lr_creator_campaigns;
create policy creator_campaigns_select_visible on public.lr_creator_campaigns for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.user_id = (select auth.uid()) and c.status = 'ACTIVE'
         and public.lr_creator_can_see_campaign(lr_creator_campaigns.id, c.id)));

drop policy if exists creator_assets_select_visible on public.lr_creator_assets;
create policy creator_assets_select_visible on public.lr_creator_assets for select to authenticated
  using (active and public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.user_id = (select auth.uid()) and c.status = 'ACTIVE'
         and (lr_creator_assets.campaign_id is null or public.lr_creator_can_see_campaign(lr_creator_assets.campaign_id, c.id))));

drop policy if exists creator_benefits_select_own on public.lr_creator_benefits;
create policy creator_benefits_select_own on public.lr_creator_benefits for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.id = lr_creator_benefits.creator_id and c.user_id = (select auth.uid())));

drop policy if exists creator_content_select_own on public.lr_creator_content;
create policy creator_content_select_own on public.lr_creator_content for select to authenticated
  using (public.lr_mfa_ok() and exists (select 1 from public.lr_creators c where c.id = lr_creator_content.creator_id and c.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Privater Speicher für Assets (kein öffentlicher Zugriff; Links werden serverseitig signiert)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-assets', 'creator-assets', false, 524288000,
  array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','application/pdf','application/zip'])
on conflict (id) do update set public = false;

insert into public.lr_settings (key, value, updated_by)
values ('creator_attribution_window_days', '90'::jsonb, 'migration:creator_hub_phase2')
on conflict (key) do nothing;

commit;
