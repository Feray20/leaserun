-- Verbesserungsvorschläge aus Privat- und Unternehmensbereich (Web-Admin → Verbesserungsvorschläge).
create table if not exists public.lr_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  area text not null check (area in ('b2c','b2b')),
  user_id uuid not null,
  account_id uuid null references public.lr_b2b_accounts(id) on delete set null,
  topic text not null check (topic in ('bedienung','rechner','kreditmappe','inhalte','neue_funktion','fehler','sonstiges')),
  text text not null check (char_length(text) between 10 and 4000),
  importance smallint not null check (importance between 1 and 5),
  page text null check (page is null or char_length(page) <= 200),
  status text not null default 'neu' check (status in ('neu','in_pruefung','geplant','umgesetzt','abgelehnt')),
  admin_rating smallint null check (admin_rating between 1 and 5),
  admin_note text null check (admin_note is null or char_length(admin_note) <= 2000),
  answer text null check (answer is null or char_length(answer) <= 2000)
);
create index if not exists lr_feedback_area_created on public.lr_feedback (area, created_at desc);
create index if not exists lr_feedback_user on public.lr_feedback (user_id);
alter table public.lr_feedback enable row level security;
revoke all on public.lr_feedback from anon, authenticated;
