-- Just One More Lord — database setup for profiles and sync.
-- Supabase → your project → SQL Editor → New query → paste all of this → Run.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  church text,
  country text,
  bio text,
  is_public boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "delete own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id);
create policy "delete own profile" on public.profiles for delete using (auth.uid() = id);
-- Names of people who chose "Let friends find me" (no email, no library data).
create or replace view public.public_profiles as
  select id, name, church, country from public.profiles where is_public;
grant select on public.public_profiles to anon, authenticated;
