-- Technische Probleme melden (Privatkonto und Unternehmensportal) mit Screenshots.
-- Ziel: Antwort innerhalb von 12 Stunden (due_at). Neue Meldungen lösen eine Push-Mitteilung an die Admin-App aus.
create table if not exists public.lr_support_tickets (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity (start with 1001),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '12 hours'),
  area text not null check (area in ('b2c','b2b')),
  user_id uuid not null,
  user_email text null check (user_email is null or char_length(user_email) <= 320),
  account_id uuid null references public.lr_b2b_accounts(id) on delete set null,
  category text not null check (category in ('anmeldung','zahlung','anzeige','werkzeug','dokument','langsam','sonstiges')),
  severity text not null check (severity in ('blockiert','stoert','klein')),
  title text not null check (char_length(title) between 3 and 140),
  text text not null check (char_length(text) between 10 and 4000),
  expected text null check (expected is null or char_length(expected) <= 2000),
  page text null check (page is null or char_length(page) <= 300),
  device jsonb not null default '{}'::jsonb,
  shots text[] not null default '{}',
  status text not null default 'neu' check (status in ('neu','in_arbeit','rueckfrage','geloest','geschlossen')),
  answer text null check (answer is null or char_length(answer) <= 4000),
  admin_note text null check (admin_note is null or char_length(admin_note) <= 2000),
  answered_at timestamptz null,
  resolved_at timestamptz null
);
create index if not exists lr_support_tickets_area_created on public.lr_support_tickets (area, created_at desc);
create index if not exists lr_support_tickets_user on public.lr_support_tickets (user_id, created_at desc);
create index if not exists lr_support_tickets_open on public.lr_support_tickets (status) where status in ('neu','in_arbeit','rueckfrage');
alter table public.lr_support_tickets enable row level security;
revoke all on public.lr_support_tickets from anon, authenticated;

-- Privater Speicher für Screenshots (nur Server mit Service-Schlüssel; Abruf über kurzlebige signierte Links).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-shots', 'support-shots', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
