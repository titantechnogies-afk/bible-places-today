-- Just One More Lord — members list (people who have joined) and sharing notes & highlights with friends.
-- Supabase → your project → SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Needs setup.sql and community.sql first (activate-all.sql includes everything).
-- Privacy: only people who tick "Show me in the members list" (profiles.is_public) appear in the list, and only
-- people who tick "Share my notes & highlights with my friends" (profiles.share_notes) are readable, and only by accepted friends.

alter table public.profiles add column if not exists share_notes boolean not null default false;

-- People who have joined (signed-in members only; only those who chose to be listed)
create or replace function public.members_list(p_search text default '')
returns table (id uuid, name text, avatar_url text, church text, country text, joined timestamptz, friend_status text)
language sql stable security definer set search_path = public, auth as $$
  select p.id, coalesce(nullif(trim(p.name), ''), 'Member'), p.avatar_url, p.church, p.country, u.created_at,
    (select case when f.status = 'accepted' then 'friends' when f.requester = auth.uid() then 'sent' else 'received' end
       from friendships f where (f.requester = auth.uid() and f.addressee = p.id) or (f.requester = p.id and f.addressee = auth.uid()) limit 1)
  from profiles p join auth.users u on u.id = p.id
  where auth.uid() is not null and p.is_public and p.id <> auth.uid()
    and (coalesce(p_search, '') = '' or p.name ilike '%' || p_search || '%' or p.church ilike '%' || p_search || '%')
  order by u.created_at desc limit 300;
$$;

-- Add a listed member as a friend (or accept their request if they already sent one)
create or replace function public.add_friend_id(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other_name text;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  if p_other = me then raise exception 'That is you'; end if;
  select coalesce(name, 'Your friend') into other_name from profiles where id = p_other and is_public;
  if other_name is null then raise exception 'That member is not available'; end if;
  -- Friends straight away: no request to accept.
  if exists (select 1 from friendships where requester = p_other and addressee = me) then
    update friendships set status = 'accepted' where requester = p_other and addressee = me;
  else
    insert into friendships (requester, addressee, status) values (me, p_other, 'accepted') on conflict (requester, addressee) do update set status = 'accepted';
  end if;
  return other_name;
end $$;

-- A friend's shared highlights, notes and saved verses
create or replace function public.friend_library(p_friend uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when p.share_notes then json_build_object('name', coalesce(p.name, 'Your friend'), 'shared', true,
              'hl', coalesce(p.data -> 'hl', '{}'::jsonb), 'notes', coalesce(p.data -> 'notes', '{}'::jsonb), 'verses', coalesce(p.data -> 'verses', '{}'::jsonb))
         else json_build_object('name', coalesce(p.name, 'Your friend'), 'shared', false) end
  from profiles p
  where p.id = p_friend and exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = p_friend) or (f.requester = p_friend and f.addressee = auth.uid())));
$$;

revoke all on function public.members_list(text), public.add_friend_id(uuid), public.friend_library(uuid) from public;
grant execute on function public.members_list(text), public.add_friend_id(uuid), public.friend_library(uuid) to authenticated;

-- Everyone who joins is listed by default (they can switch it off: Friends page or My profile).
alter table public.profiles alter column is_public set default true;
-- Create a profile the moment someone signs up, so every member can be found.
create or replace function public.jom_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, is_public) values (new.id, nullif(trim(new.raw_user_meta_data ->> 'name'), ''), true) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists jom_on_auth_user_created on auth.users;
create trigger jom_on_auth_user_created after insert on auth.users for each row execute function public.jom_new_user();
-- Members who signed up before this existed but never got a profile.
insert into public.profiles (id, name, is_public)
  select u.id, nullif(trim(u.raw_user_meta_data ->> 'name'), ''), true from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id);
-- Friend requests made before "add friend = friends straight away" become friendships.
update public.friendships set status = 'accepted' where status = 'pending';
