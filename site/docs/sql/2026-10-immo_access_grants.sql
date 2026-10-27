-- Manuelle Freischaltung durch den Web-Admin (z. B. Kunde zahlt Kreditmappe, erhält aber alle Werkzeuge).
create table if not exists public.lr_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null check (tier in ('starter','pro')),
  credit_maps integer not null default 0 check (credit_maps between 0 and 1000),
  leitfaden boolean not null default false,
  valid_until timestamptz null,
  note text null check (note is null or char_length(note) <= 500),
  granted_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lr_access_grants enable row level security;
revoke all on public.lr_access_grants from anon, authenticated;

-- Einmalige Bitte um eine Bewertung nach dem Kauf (nur mit Einwilligung im Kaufdialog), gegen Doppelversand.
create table if not exists public.lr_review_requests (
  session_id text primary key,
  user_id uuid null,
  area text not null default 'b2c' check (area in ('b2c','b2b')),
  sent_at timestamptz not null default now()
);
alter table public.lr_review_requests enable row level security;
revoke all on public.lr_review_requests from anon, authenticated;
