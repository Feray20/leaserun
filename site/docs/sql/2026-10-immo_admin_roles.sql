-- Teammitglieder mit eingeschränkter Rolle für Web-Admin und Admin-App.
-- Inhaber bleiben weiterhin ausschließlich über ADMIN_EMAILS (Vercel) festgelegt.
create table if not exists public.lr_admin_roles (
  email text primary key check (email = lower(email) and char_length(email) <= 200),
  role text not null check (role in ('support','finance','viewer')),
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.lr_admin_roles enable row level security;
revoke all on public.lr_admin_roles from anon, authenticated;
