-- Just One More Lord — private "Send us a message for help" inbox (Freedom section).
-- Supabase → your project → SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Anyone (signed in or not) can SEND a message. Only the app admins listed in app_admins can READ them.

-- 1) Who can read the messages
create table if not exists public.app_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.app_admins enable row level security;   -- no policies: nobody can read or change this list from the website
create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

-- 2) The messages
create table if not exists public.help_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text check (name is null or char_length(name) <= 80),
  contact text not null check (char_length(contact) between 3 and 120),
  topics text[] not null default '{}' check (cardinality(topics) <= 10),
  message text not null check (char_length(message) between 2 and 2000),
  user_id uuid default auth.uid(),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  note text check (note is null or char_length(note) <= 1000)
);
alter table public.help_requests enable row level security;
grant insert on public.help_requests to anon, authenticated;
grant select, update, delete on public.help_requests to authenticated;
drop policy if exists "anyone can ask for help" on public.help_requests;
drop policy if exists "admins read help" on public.help_requests;
drop policy if exists "admins update help" on public.help_requests;
drop policy if exists "admins delete help" on public.help_requests;
create policy "anyone can ask for help" on public.help_requests for insert to anon, authenticated with check (status = 'new' and note is null);
create policy "admins read help" on public.help_requests for select to authenticated using (public.is_app_admin());
create policy "admins update help" on public.help_requests for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admins delete help" on public.help_requests for delete to authenticated using (public.is_app_admin());

-- 3) MAKE YOURSELF THE ADMIN: first sign up in the app with your email, then change the email below to yours and run this line.
insert into public.app_admins (user_id) select id from auth.users where email = 'YOUR-EMAIL-HERE' on conflict do nothing;
