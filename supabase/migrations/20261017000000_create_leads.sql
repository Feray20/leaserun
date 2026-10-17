-- LeaseRun: website lead capture table
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (char_length(source) <= 60),
  page text check (char_length(page) <= 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  first_name text check (char_length(first_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  phone text check (char_length(phone) <= 40),
  interest text check (char_length(interest) <= 120),
  budget text check (char_length(budget) <= 60),
  capital text check (char_length(capital) <= 60),
  timeline text check (char_length(timeline) <= 60),
  doors text check (char_length(doors) <= 20),
  notes text check (char_length(notes) <= 2000),
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost'))
);
comment on table public.leads is 'Website lead captures (deal sheet opt-ins, portfolio audit requests, owner onboarding).';
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_source_idx on public.leads (source);

alter table public.leads enable row level security;

-- Website visitors may only insert new leads with default status; nobody can read via the public API.
create policy "Public can submit leads"
  on public.leads for insert
  to anon, authenticated
  with check (status = 'new');

revoke select, update, delete on public.leads from anon, authenticated;
grant insert on public.leads to anon, authenticated;
