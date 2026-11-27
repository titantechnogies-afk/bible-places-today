-- Just One More Lord — public member count for the home screen.
-- Supabase → your project → SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Returns only two numbers (everyone who has signed up, and how many joined in the last 7 days). No names, emails or other details.
create or replace function public.member_count() returns json
language sql stable security definer set search_path = public, auth as $$
  select json_build_object(
    'members', (select count(*) from auth.users),
    'week', (select count(*) from auth.users where created_at > now() - interval '7 days'));
$$;
revoke all on function public.member_count() from public;
grant execute on function public.member_count() to anon, authenticated;
