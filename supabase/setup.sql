-- Just One More Lord — database setup for profiles and sync.
-- Supabase → your project → SQL Editor → New query → paste all of this → Run. Safe to run again.
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
grant select, insert, update, delete on public.profiles to authenticated;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "delete own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "insert own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id);
create policy "delete own profile" on public.profiles for delete to authenticated using ((select auth.uid()) = id);
-- (An earlier version created a public_profiles view; it is not needed yet.)
drop view if exists public.public_profiles;
-- Supabase's "enable RLS automatically" helper should not be callable from the website.
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
