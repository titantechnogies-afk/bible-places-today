-- Just One More Lord — community features: profile pictures, friends with online status, testimonies,
-- church finder, prayer partners and live group reading.
-- Supabase → SQL Editor → New query → paste ALL of this → Run. Safe to run again.
-- Run setup.sql first (profiles and church groups).

-- ===== Profiles: picture, friend code, online status, prayer focus =====
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists show_online boolean not null default true;
alter table public.profiles add column if not exists friend_code text;
alter table public.profiles add column if not exists prayer_focus text check (char_length(prayer_focus) <= 300);
update public.profiles set friend_code = upper(substr(md5(random()::text || id::text), 1, 6)) where friend_code is null;
alter table public.profiles alter column friend_code set default upper(substr(md5(random()::text), 1, 6));
create unique index if not exists profiles_friend_code on public.profiles (friend_code);

-- ===== Profile pictures (public bucket; each person can only write their own file) =====
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do update set public = true;
drop policy if exists "avatar read own" on storage.objects;
drop policy if exists "avatar insert own" on storage.objects;
drop policy if exists "avatar update own" on storage.objects;
drop policy if exists "avatar delete own" on storage.objects;
create policy "avatar read own" on storage.objects for select to authenticated using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
create policy "avatar insert own" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
create policy "avatar update own" on storage.objects for update to authenticated using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg') with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
create policy "avatar delete own" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');

-- ===== Friends =====
create table if not exists public.friendships (
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
grant select, delete on public.friendships to authenticated;
drop policy if exists "see my friendships" on public.friendships;
drop policy if exists "remove my friendships" on public.friendships;
create policy "see my friendships" on public.friendships for select to authenticated using ((select auth.uid()) in (requester, addressee));
create policy "remove my friendships" on public.friendships for delete to authenticated using ((select auth.uid()) in (requester, addressee));

create or replace function public.add_friend(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other uuid; other_name text;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  select id, coalesce(name, 'Your friend') into other, other_name from profiles where friend_code = upper(trim(p_code));
  if other is null then raise exception 'No one has that friend code'; end if;
  if other = me then raise exception 'That is your own code'; end if;
  if exists (select 1 from friendships where requester = other and addressee = me) then
    update friendships set status = 'accepted' where requester = other and addressee = me;
  else
    insert into friendships (requester, addressee) values (me, other) on conflict do nothing;
  end if;
  return other_name;
end $$;

create or replace function public.respond_friend(p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_accept then update friendships set status = 'accepted' where requester = p_other and addressee = auth.uid();
  else delete from friendships where requester = p_other and addressee = auth.uid(); end if;
end $$;

create or replace function public.my_friends() returns table (id uuid, name text, avatar_url text, church text, last_seen timestamptz, status text, incoming boolean, prayer_focus text)
language sql security definer set search_path = public stable as $$
  select p.id, coalesce(p.name, 'Friend'), p.avatar_url, p.church,
         case when p.show_online and f.status = 'accepted' then p.last_seen end,
         f.status, f.addressee = auth.uid(),
         case when f.status = 'accepted' then p.prayer_focus end
  from friendships f join profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee);
$$;

create or replace function public.touch_online() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

create or replace function public.set_my_extras(p_show_online boolean, p_prayer_focus text) returns text
language sql security definer set search_path = public as $$
  update profiles set show_online = coalesce(p_show_online, show_online), prayer_focus = left(p_prayer_focus, 300) where id = auth.uid() returning friend_code;
$$;

-- ===== Testimonies (visible to everyone; hidden automatically after 3 reports) =====
create table if not exists public.testimonies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text, avatar_url text,
  kind text not null default 'answered prayer' check (kind in ('answered prayer', 'healing', 'salvation', 'provision', 'other')),
  text text not null check (char_length(text) between 10 and 1200),
  reports int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.testimony_reports (testimony uuid references public.testimonies(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, primary key (testimony, user_id));
alter table public.testimonies enable row level security;
alter table public.testimony_reports enable row level security;
grant select on public.testimonies to anon, authenticated;
grant insert, delete on public.testimonies to authenticated;
drop policy if exists "read testimonies" on public.testimonies;
drop policy if exists "add my testimony" on public.testimonies;
drop policy if exists "delete my testimony" on public.testimonies;
create policy "read testimonies" on public.testimonies for select to anon, authenticated using (reports < 3 or user_id = (select auth.uid()));
create policy "add my testimony" on public.testimonies for insert to authenticated with check (user_id = (select auth.uid()) and reports = 0);
create policy "delete my testimony" on public.testimonies for delete to authenticated using (user_id = (select auth.uid()));
create or replace function public.report_testimony(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into testimony_reports values (p_id, auth.uid()) on conflict do nothing;
  if found then update testimonies set reports = reports + 1 where id = p_id; end if;
end $$;

-- ===== Church finder (anyone signed in can add; hidden after 3 reports) =====
create table if not exists public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 100),
  city text check (char_length(city) <= 80),
  country text check (char_length(country) <= 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  website text check (char_length(website) <= 200),
  about text check (char_length(about) <= 400),
  added_by uuid references auth.users(id) on delete set null,
  reports int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.church_reports (church uuid references public.churches(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, primary key (church, user_id));
alter table public.churches enable row level security;
alter table public.church_reports enable row level security;
grant select on public.churches to anon, authenticated;
grant insert, delete on public.churches to authenticated;
drop policy if exists "read churches" on public.churches;
drop policy if exists "add church" on public.churches;
drop policy if exists "delete my church" on public.churches;
create policy "read churches" on public.churches for select to anon, authenticated using (reports < 3);
create policy "add church" on public.churches for insert to authenticated with check (added_by = (select auth.uid()) and reports = 0);
create policy "delete my church" on public.churches for delete to authenticated using (added_by = (select auth.uid()));
create or replace function public.report_church(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into church_reports values (p_id, auth.uid()) on conflict do nothing;
  if found then update churches set reports = reports + 1 where id = p_id; end if;
end $$;
insert into public.churches (name, city, country, lat, lng, website, about)
select 'Harvest Church', 'uMhlanga, Durban', 'South Africa', -29.7260, 31.0840, 'https://harvestchurch.co.za/', 'Head pastors Richard and Tanya Olivier. Preaching the finished works of Jesus and the love of God.'
where not exists (select 1 from public.churches where name = 'Harvest Church');

-- ===== Prayer partners (paired with someone new each week) =====
create table if not exists public.prayer_pool (user_id uuid primary key references auth.users(id) on delete cascade, joined_at timestamptz not null default now());
create table if not exists public.prayer_partners (a uuid references auth.users(id) on delete cascade, b uuid references auth.users(id) on delete cascade, week date not null, primary key (a, week));
alter table public.prayer_pool enable row level security;
alter table public.prayer_partners enable row level security;
create or replace function public.prayer_partner(p_join boolean default false) returns table (id uuid, name text, avatar_url text, prayer_focus text, waiting boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); wk date := date_trunc('week', now())::date; other uuid;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  select pp.b into other from prayer_partners pp where pp.a = me and pp.week = wk;
  if other is null and p_join then
    select q.user_id into other from prayer_pool q where q.user_id <> me
      and not exists (select 1 from prayer_partners x where x.a = q.user_id and x.week = wk) order by q.joined_at limit 1 for update skip locked;
    if other is not null then
      insert into prayer_partners values (me, other, wk), (other, me, wk) on conflict do nothing;
      delete from prayer_pool where user_id in (me, other);
    else
      insert into prayer_pool (user_id) values (me) on conflict do nothing;
    end if;
  end if;
  if other is not null then
    return query select p.id, coalesce(p.name, 'Your partner'), p.avatar_url, p.prayer_focus, false from profiles p where p.id = other;
  else
    return query select null::uuid, null::text, null::text, null::text, exists (select 1 from prayer_pool q where q.user_id = me);
  end if;
end $$;

-- ===== Live group reading (members of a church group chat while reading the same chapter) =====
create table if not exists public.group_live (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text, ref text check (char_length(ref) <= 40),
  text text not null check (char_length(text) between 1 and 400),
  created_at timestamptz not null default now()
);
alter table public.group_live enable row level security;
grant select, insert, delete on public.group_live to authenticated;
drop policy if exists "members read live" on public.group_live;
drop policy if exists "members write live" on public.group_live;
drop policy if exists "delete my live" on public.group_live;
create policy "members read live" on public.group_live for select to authenticated using (public.is_member(group_id));
create policy "members write live" on public.group_live for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(group_id));
create policy "delete my live" on public.group_live for delete to authenticated using (user_id = (select auth.uid()));
create index if not exists group_live_g on public.group_live (group_id, id);

-- Only signed-in people may call these
revoke all on function public.add_friend(text), public.respond_friend(uuid, boolean), public.my_friends(), public.touch_online(),
  public.set_my_extras(boolean, text), public.report_testimony(uuid), public.report_church(uuid), public.prayer_partner(boolean) from public, anon;
grant execute on function public.add_friend(text), public.respond_friend(uuid, boolean), public.my_friends(), public.touch_online(),
  public.set_my_extras(boolean, text), public.report_testimony(uuid), public.report_church(uuid), public.prayer_partner(boolean) to authenticated;
