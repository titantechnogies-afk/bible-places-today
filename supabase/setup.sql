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

-- ===================== CHURCH GROUPS (run this part too) =====================
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  owner uuid not null references auth.users(id) on delete cascade,
  plan_id text,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  role text not null default 'member',
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table if not exists public.group_prayers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  text text not null check (char_length(text) <= 600),
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_prayers enable row level security;
grant select, update on public.groups to authenticated;
grant select, update, delete on public.group_members to authenticated;
grant select, insert, delete on public.group_prayers to authenticated;
create or replace function public.is_member(g uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.group_members where group_id = g and user_id = (select auth.uid())) $$;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
drop policy if exists "members read group" on public.groups;
drop policy if exists "owner updates group" on public.groups;
drop policy if exists "members read members" on public.group_members;
drop policy if exists "update own membership" on public.group_members;
drop policy if exists "leave or owner removes" on public.group_members;
drop policy if exists "members read prayers" on public.group_prayers;
drop policy if exists "members post prayers" on public.group_prayers;
drop policy if exists "delete own or owner" on public.group_prayers;
create policy "members read group" on public.groups for select to authenticated using (public.is_member(id));
create policy "owner updates group" on public.groups for update to authenticated using (owner = (select auth.uid()));
create policy "members read members" on public.group_members for select to authenticated using (public.is_member(group_id));
create policy "update own membership" on public.group_members for update to authenticated using (user_id = (select auth.uid()));
create policy "leave or owner removes" on public.group_members for delete to authenticated using (user_id = (select auth.uid()) or exists (select 1 from public.groups g where g.id = group_id and g.owner = (select auth.uid())));
create policy "members read prayers" on public.group_prayers for select to authenticated using (public.is_member(group_id));
create policy "members post prayers" on public.group_prayers for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(group_id));
create policy "delete own or owner" on public.group_prayers for delete to authenticated using (user_id = (select auth.uid()) or exists (select 1 from public.groups g where g.id = group_id and g.owner = (select auth.uid())));
create or replace function public.create_group(p_name text, p_code text, p_member_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  insert into public.groups (name, code, owner) values (left(p_name, 60), upper(p_code), (select auth.uid())) returning id into gid;
  insert into public.group_members (group_id, user_id, name, role) values (gid, (select auth.uid()), left(p_member_name, 40), 'leader');
  return gid; end $$;
create or replace function public.join_group(p_code text, p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select id into gid from public.groups where code = upper(trim(p_code));
  if gid is null then raise exception 'Group not found'; end if;
  insert into public.group_members (group_id, user_id, name) values (gid, (select auth.uid()), left(p_name, 40)) on conflict (group_id, user_id) do nothing;
  return gid; end $$;
revoke execute on function public.create_group(text, text, text) from public, anon;
revoke execute on function public.join_group(text, text) from public, anon;
grant execute on function public.create_group(text, text, text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;

-- ===================== PHONE NOTIFICATIONS =====================
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  keys jsonb not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant insert on public.push_subscriptions to anon, authenticated;
drop policy if exists "anyone can subscribe" on public.push_subscriptions;
create policy "anyone can subscribe" on public.push_subscriptions for insert to anon, authenticated with check (user_id is null or user_id = (select auth.uid()));
