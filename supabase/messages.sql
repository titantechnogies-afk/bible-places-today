-- Just One More Lord — private messages between friends (with verse cards, block and report).
-- Supabase → your project → SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Needs activate-all.sql (or setup.sql + community.sql + help.sql) first.
-- Rules: only friends can message each other; nobody can message someone who blocked them;
-- people can only read their own conversations; reported messages go to the app admins (Help messages screen).

-- 1) Tables
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  verse_ref text check (verse_ref is null or char_length(verse_ref) <= 80),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed boolean not null default false,
  hidden_for uuid[] not null default '{}'
);
create index if not exists messages_pair_idx on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread_idx on public.messages (recipient) where read_at is null;

create table if not exists public.user_blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message uuid references public.messages(id) on delete set null,
  reporter uuid not null references auth.users(id) on delete cascade,
  reported uuid references auth.users(id) on delete set null,
  body text,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'done'))
);

-- Everything goes through the functions below; the tables themselves are closed to the website.
alter table public.messages enable row level security;
alter table public.user_blocks enable row level security;
alter table public.message_reports enable row level security;
revoke all on public.messages, public.user_blocks, public.message_reports from anon, authenticated;

-- 2) Helpers
create or replace function public.jom_are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
create or replace function public.jom_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public.jom_are_friends(uuid, uuid), public.jom_blocked(uuid, uuid) from public, anon, authenticated;

-- 3) Send a message (text and/or a verse card)
create or replace function public.send_message(p_to uuid, p_body text, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); new_id uuid; b text := trim(coalesce(p_body, ''));
begin
  if me is null then raise exception 'Please sign in first'; end if;
  if p_to = me then raise exception 'You cannot message yourself'; end if;
  if b = '' then raise exception 'Write a message first'; end if;
  if char_length(b) > 2000 then raise exception 'That message is too long (2000 letters max)'; end if;
  if not jom_are_friends(me, p_to) then raise exception 'You can only message your friends. Add them as a friend first.'; end if;
  if jom_blocked(me, p_to) then raise exception 'You cannot message this person.'; end if;
  if (select count(*) from messages where sender = me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little — try again in a minute.'; end if;
  insert into messages (sender, recipient, body, verse_ref) values (me, p_to, b, nullif(left(trim(coalesce(p_ref, '')), 80), ''))
    returning id into new_id;
  return new_id;
end $$;

-- 4) My conversations (newest first) with unread counts
create or replace function public.my_chats() returns table (
  other uuid, name text, avatar_url text, last_body text, last_ref text, last_at timestamptz, last_mine boolean,
  unread int, last_seen timestamptz, is_friend boolean, blocked_by_me boolean)
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.*, case when m.sender = auth.uid() then m.recipient else m.sender end as o
    from messages m where (m.sender = auth.uid() or m.recipient = auth.uid()) and not (auth.uid() = any(m.hidden_for))
  ), last as (select distinct on (o) * from mine order by o, created_at desc)
  select l.o, coalesce(nullif(trim(p.name), ''), 'Member'), p.avatar_url, l.body, l.verse_ref, l.created_at, l.sender = auth.uid(),
    (select count(*)::int from mine x where x.o = l.o and x.recipient = auth.uid() and x.read_at is null),
    case when p.show_online then p.last_seen end,
    jom_are_friends(auth.uid(), l.o),
    exists (select 1 from user_blocks ub where ub.blocker = auth.uid() and ub.blocked = l.o)
  from last l left join profiles p on p.id = l.o
  where auth.uid() is not null
  order by l.created_at desc limit 200;
$$;

-- 5) One conversation (the newest 100, or older ones before p_before) — also marks them as read
create or replace function public.chat_with(p_other uuid, p_before timestamptz default null) returns table (
  id uuid, mine boolean, body text, verse_ref text, created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first'; end if;
  update messages m set read_at = now() where m.recipient = me and m.sender = p_other and m.read_at is null;
  return query select m.id, m.sender = me, m.body, m.verse_ref, m.created_at, m.read_at from (
      select * from messages m2
      where ((m2.sender = me and m2.recipient = p_other) or (m2.sender = p_other and m2.recipient = me))
        and not (me = any(m2.hidden_for)) and (p_before is null or m2.created_at < p_before)
      order by m2.created_at desc limit 100) m
    order by m.created_at;
end $$;

-- 6) Unread count for the badge
create or replace function public.unread_messages() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from messages where recipient = auth.uid() and read_at is null and not (auth.uid() = any(hidden_for));
$$;

-- 7) Clear a conversation from MY phone list (the other person keeps theirs)
create or replace function public.hide_chat(p_other uuid) returns void
language sql security definer set search_path = public as $$
  update messages set hidden_for = array_append(hidden_for, auth.uid()), read_at = coalesce(read_at, case when recipient = auth.uid() then now() end)
  where ((sender = auth.uid() and recipient = p_other) or (sender = p_other and recipient = auth.uid()))
    and not (auth.uid() = any(hidden_for));
$$;

-- 8) Block / unblock
create or replace function public.block_user(p_other uuid, p_block boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if p_block then insert into user_blocks (blocker, blocked) values (auth.uid(), p_other) on conflict do nothing;
  else delete from user_blocks where blocker = auth.uid() and blocked = p_other; end if;
end $$;

-- 9) Report a message (a copy of the words is kept for the admins even if it is later deleted)
create or replace function public.report_message(p_msg uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  select * into m from messages where id = p_msg and recipient = auth.uid();
  if m.id is null then raise exception 'Message not found'; end if;
  insert into message_reports (message, reporter, reported, body, reason) values (m.id, auth.uid(), m.sender, m.body, left(p_reason, 500));
end $$;

-- 10) For the admins: reported messages
create or replace function public.admin_message_reports() returns table (
  id uuid, created_at timestamptz, reporter_name text, reported uuid, reported_name text, body text, reason text, status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, coalesce(a.name, 'Member'), r.reported, coalesce(b.name, 'Member'), r.body, r.reason, r.status
  from message_reports r left join profiles a on a.id = r.reporter left join profiles b on b.id = r.reported
  where public.is_app_admin() order by r.status = 'done', r.created_at desc limit 200;
$$;
create or replace function public.admin_report_done(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update message_reports set status = 'done' where id = p_id and public.is_app_admin();
$$;

-- 11) Link this phone's notifications to my account (for message notifications)
create or replace function public.claim_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  update push_subscriptions set user_id = auth.uid() where endpoint = p_endpoint and auth.uid() is not null;
$$;

revoke all on function public.send_message(uuid, text, text), public.my_chats(), public.chat_with(uuid, timestamptz), public.unread_messages(),
  public.hide_chat(uuid), public.block_user(uuid, boolean), public.report_message(uuid, text), public.admin_message_reports(),
  public.admin_report_done(uuid), public.claim_push(text) from public, anon;
grant execute on function public.send_message(uuid, text, text), public.my_chats(), public.chat_with(uuid, timestamptz), public.unread_messages(),
  public.hide_chat(uuid), public.block_user(uuid, boolean), public.report_message(uuid, text), public.admin_message_reports(),
  public.admin_report_done(uuid), public.claim_push(text) to authenticated;

select 'messages switched on' as result;
