-- Push-Geräte der Admin-App (Mitteilungen bei neuer Zahlung, E-Mail, Terminanfrage).
-- Nur über den Server (Service-Rolle) lesbar und schreibbar.
create table if not exists public.lr_admin_push_tokens (
  token text primary key check (char_length(token) <= 200),
  user_id uuid not null,
  email text not null,
  platform text not null default 'ios' check (platform in ('ios','android')),
  prefs jsonb not null default '{"payment":true,"mail":true,"booking":true,"security":true}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists lr_admin_push_tokens_email on public.lr_admin_push_tokens (email);
alter table public.lr_admin_push_tokens enable row level security;
revoke all on public.lr_admin_push_tokens from anon, authenticated;
create index if not exists lr_admin_push_tokens_user on public.lr_admin_push_tokens (user_id);
