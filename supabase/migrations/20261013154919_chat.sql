-- =============================================================================
-- Migration chat (M4): who is here, chat requests, conversations and messages,
-- live notices over private Realtime channels, and the clean-up when a visit
-- ends. ARCHITECTURE §4.7–4.9, §4.13, §7.
--
-- Not here yet: push notifications (M4 phase 4), keeping a subscriber's
-- history (M5), block and report buttons (M6; the blocks table is created now
-- so every check below is written once).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Blocks (filled from M6; already respected everywhere)
-- -----------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid        not null references public.profiles (id) on delete cascade,
  blocked_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint ck_blocks_not_self check (blocker_id <> blocked_id)
);
create index ix_blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security;
revoke all on table public.blocks from anon, authenticated;

create function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;
revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Live notices
-- -----------------------------------------------------------------------------
-- Every server notice goes through here: a private broadcast on one topic
-- (§7). realtime.send never raises (it turns failures into warnings), and its
-- message is only delivered if this transaction commits, so a notice can
-- neither break nor run ahead of the change it announces.
create function public.notify(p_topic text, p_event text, p_payload jsonb default '{}'::jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select realtime.send(p_payload, p_event, p_topic, true);
$$;
revoke all on function public.notify(text, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Conversations, members, messages
-- -----------------------------------------------------------------------------
create table public.conversations (
  id              uuid        primary key default gen_random_uuid(),
  user_low_id     uuid        not null references public.profiles (id) on delete cascade,
  user_high_id    uuid        not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_conversations_pair check (user_low_id < user_high_id),
  constraint uq_conversations_pair unique (user_low_id, user_high_id)
);
comment on table public.conversations is
  'One per pair of guests, ever. Deleted (with its messages) when no member still sees it.';
create index ix_conversations_high on public.conversations (user_high_id);

create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_members (
  conversation_id         uuid        not null references public.conversations (id) on delete cascade,
  user_id                 uuid        not null references public.profiles (id) on delete cascade,
  visible_from_message_id bigint      not null default 0,
  last_read_message_id    bigint      not null default 0,
  hidden_at               timestamptz,
  created_at              timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
comment on column public.conversation_members.visible_from_message_id is
  'First message id this member may see: a new chat with an old pair starts empty.';
comment on column public.conversation_members.hidden_at is
  'Set when this member''s visit ends (no subscription): they no longer see the conversation.';
create index ix_conversation_members_user on public.conversation_members (user_id) where hidden_at is null;

create table public.messages (
  id                bigint      generated always as identity primary key,
  conversation_id   uuid        not null references public.conversations (id) on delete cascade,
  sender_user_id    uuid        not null references public.profiles (id) on delete cascade,
  sender_session_id uuid        references public.sessions (id) on delete set null,
  client_msg_id     uuid        not null,
  body              text        not null,
  created_at        timestamptz not null default now(),
  constraint ck_messages_body check (char_length(body) between 1 and 1000),
  constraint uq_messages_sender_client unique (sender_user_id, client_msg_id)
);
comment on column public.messages.client_msg_id is
  'Made by the phone before sending; a retried send returns the first message instead of a duplicate.';
create index ix_messages_conv_id on public.messages (conversation_id, id desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
revoke all on table public.conversations, public.conversation_members, public.messages from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Chat requests
-- -----------------------------------------------------------------------------
create table public.chat_requests (
  id              uuid        primary key default gen_random_uuid(),
  venue_id        uuid        not null references public.venues (id) on delete cascade,
  from_session_id uuid        not null references public.sessions (id) on delete cascade,
  to_session_id   uuid        not null references public.sessions (id) on delete cascade,
  from_user_id    uuid        not null references public.profiles (id) on delete cascade,
  to_user_id      uuid        not null references public.profiles (id) on delete cascade,
  status          text        not null default 'pending',
  expires_at      timestamptz not null,
  responded_at    timestamptz,
  conversation_id uuid        references public.conversations (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_chat_requests_status  check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  constraint ck_chat_requests_not_self check (from_session_id <> to_session_id and from_user_id <> to_user_id),
  constraint ck_chat_requests_responded check ((status = 'pending') = (responded_at is null))
);
comment on table public.chat_requests is
  'Between two sessions (one visit each). Accepted = those two sessions may chat; declined = no new request during them.';
-- At most one pending request per pair, whichever way it goes.
create unique index uq_chat_requests_pending_pair on public.chat_requests
  (least(from_session_id, to_session_id), greatest(from_session_id, to_session_id)) where status = 'pending';
create index ix_chat_requests_to      on public.chat_requests (to_session_id) where status = 'pending';
create index ix_chat_requests_from    on public.chat_requests (from_session_id, to_session_id);
create index ix_chat_requests_expiry  on public.chat_requests (expires_at) where status = 'pending';
create index ix_chat_requests_conv    on public.chat_requests (conversation_id) where status = 'accepted';
create index ix_chat_requests_venue   on public.chat_requests (venue_id);
create index ix_chat_requests_to_user on public.chat_requests (to_user_id);
create index ix_chat_requests_from_user on public.chat_requests (from_user_id);

create trigger trg_chat_requests_updated_at
  before update on public.chat_requests
  for each row execute function public.set_updated_at();

alter table public.chat_requests enable row level security;
revoke all on table public.chat_requests from anon, authenticated;

-- The request linking two sessions, most decisive first: accepted, pending, declined.
create function public.request_between(p_session_a uuid, p_session_b uuid)
returns public.chat_requests
language sql
stable
set search_path = ''
as $$
  select r.* from public.chat_requests r
  where ((r.from_session_id = p_session_a and r.to_session_id = p_session_b)
      or (r.from_session_id = p_session_b and r.to_session_id = p_session_a))
    and r.status in ('accepted', 'pending', 'declined')
  order by case r.status when 'accepted' then 0 when 'pending' then 1 else 2 end
  limit 1;
$$;
revoke all on function public.request_between(uuid, uuid) from public, anon, authenticated;

create function public.live_session_of(p_user_id uuid)
returns public.sessions
language sql
stable
set search_path = ''
as $$
  select * from public.sessions where user_id = p_user_id and status <> 'ended';
$$;
revoke all on function public.live_session_of(uuid) from public, anon, authenticated;

-- Who may write in a conversation (§4.8): both people are in live sessions at
-- the same venue, those two sessions have an accepted request, and neither
-- blocked the other. Anyone else who still sees it reads it only.
create function public.can_send(p_conversation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  c       public.conversations%rowtype;
  v_other uuid;
  me      public.sessions%rowtype;
  them    public.sessions%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or p_user_id not in (c.user_low_id, c.user_high_id) then
    return false;
  end if;
  v_other := case when c.user_low_id = p_user_id then c.user_high_id else c.user_low_id end;
  me := public.live_session_of(p_user_id);
  them := public.live_session_of(v_other);
  if me.id is null or them.id is null or me.venue_id <> them.venue_id then
    return false;
  end if;
  return (public.request_between(me.id, them.id)).status = 'accepted'
     and not public.is_blocked_pair(p_user_id, v_other);
end;
$$;
revoke all on function public.can_send(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime authorization (§7): RLS on realtime.messages
-- -----------------------------------------------------------------------------
--   user:{id}    only that guest, listen only (the server is the only sender)
--   venue:{id}   guests with a live session there, listen only
--   conv:{id}    members who still see it and have a live session; may also
--                send (the "typing…" broadcast, which is never stored)
-- Executable by authenticated because RLS policies run as the caller; it only
-- answers about the caller's own access.
create function public.realtime_topic_allowed(p_topic text, p_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null or p_topic is null then
    return false;
  end if;
  if p_topic = 'user:' || v_user::text then
    return not p_send;
  end if;
  if p_topic ~ '^venue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substr(p_topic, 7)::uuid;
    return not p_send and exists (
      select 1 from public.sessions s where s.user_id = v_user and s.status <> 'ended' and s.venue_id = v_id);
  end if;
  if p_topic ~ '^conv:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substr(p_topic, 6)::uuid;
    return exists (
             select 1 from public.conversation_members m
             where m.conversation_id = v_id and m.user_id = v_user and m.hidden_at is null)
       and exists (select 1 from public.sessions s where s.user_id = v_user and s.status <> 'ended');
  end if;
  return false;
end;
$$;
revoke all on function public.realtime_topic_allowed(text, boolean) from public, anon, authenticated;
grant execute on function public.realtime_topic_allowed(text, boolean) to authenticated;

create policy introchat_receive on realtime.messages
  for select to authenticated
  using (public.realtime_topic_allowed((select realtime.topic()), false));

create policy introchat_send_typing on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.realtime_topic_allowed((select realtime.topic()), true));

-- -----------------------------------------------------------------------------
-- Session notices: one trigger instead of a notice in every function
-- -----------------------------------------------------------------------------
-- Whatever changes a session (start, heartbeat, the tick, continue, logout,
-- later kicks and bans), the people at the venue and the guest themselves are
-- told. Clients treat every notice as "re-fetch", never as the data itself.
create function public.sessions_broadcast()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_venue text := 'venue:' || new.venue_id::text;
  v_user  text := 'user:' || new.user_id::text;
  v_ref   jsonb := jsonb_build_object('session_id', new.id);
begin
  if tg_op = 'INSERT' then
    perform public.notify(v_venue, 'person.joined', v_ref);
    return null;
  end if;

  if old.status <> 'ended' and new.status = 'ended' then
    perform public.notify(v_venue, 'person.left', v_ref);
    perform public.notify(v_user, 'session.ended', v_ref || jsonb_build_object('reason', new.end_reason));
    return null;
  end if;
  if new.status = 'ended' then
    return null;
  end if;

  if old.is_offline <> new.is_offline then
    perform public.notify(v_venue, case when new.is_offline then 'person.offline' else 'person.online' end, v_ref);
  end if;
  if old.warning_sent_at is null and new.warning_sent_at is not null and new.status = 'active' then
    perform public.notify(v_user, 'session.warning', v_ref);
  end if;
  if old.status = 'active' and new.status = 'final_prompt' then
    perform public.notify(v_user, 'session.final_prompt', v_ref);
  end if;
  if old.expires_at <> new.expires_at then
    perform public.notify(v_user, 'session.extended', v_ref);
  end if;
  return null;
end;
$$;
revoke all on function public.sessions_broadcast() from public, anon, authenticated;

create trigger trg_sessions_broadcast
  after insert or update on public.sessions
  for each row execute function public.sessions_broadcast();

-- -----------------------------------------------------------------------------
-- end_session: now also closes requests and chats (§4.13)
-- -----------------------------------------------------------------------------
create or replace function public.end_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
  r record;
begin
  if p_reason is null or p_reason not in
     ('expired', 'left_venue', 'user_logout', 'kicked', 'banned', 'venue_closed') then
    raise exception 'END_REASON_INVALID' using detail = coalesce(p_reason, 'null');
  end if;
  select * into s from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if s.status = 'ended' then
    return;
  end if;

  update public.sessions
  set status            = 'ended',
      ended_at          = now(),
      end_reason        = p_reason,
      final_deadline_at = null,
      away_since        = null,
      -- The raw position is kept only while the session is live (§3.4).
      last_lat          = null,
      last_lng          = null,
      last_taken_at     = null
  where id = s.id;

  -- Requests to or from this visit can no longer be answered.
  for r in
    update public.chat_requests
    set status = 'cancelled', responded_at = now()
    where status = 'pending' and (from_session_id = s.id or to_session_id = s.id)
    returning id, case when from_user_id = s.user_id then to_user_id else from_user_id end as other_user
  loop
    perform public.notify('user:' || r.other_user::text, 'request.cancelled', jsonb_build_object('request_id', r.id));
  end loop;

  -- This guest stops seeing their chats (no subscriptions yet: history is
  -- never kept, decision 10; M5 keeps it for subscribers). The other person
  -- keeps reading it, read-only, until their own visit ends.
  for r in
    update public.conversation_members m
    set hidden_at = now()
    where m.user_id = s.user_id and m.hidden_at is null
    returning m.conversation_id
  loop
    perform public.notify('user:' || o.user_id::text, 'chat.closed', jsonb_build_object('conversation_id', r.conversation_id))
    from public.conversation_members o
    where o.conversation_id = r.conversation_id and o.user_id <> s.user_id and o.hidden_at is null;
  end loop;
  -- Conversations nobody sees any more are deleted, with their messages.
  delete from public.conversations c
  where (c.user_low_id = s.user_id or c.user_high_id = s.user_id)
    and not exists (select 1 from public.conversation_members m
                    where m.conversation_id = c.id and m.hidden_at is null);

  if p_reason in ('kicked', 'banned', 'venue_closed') then
    perform public.write_audit('system', null, 'session.end', 'session', s.id, s.venue_id,
                               jsonb_build_object('reason', p_reason));
  end if;
end;
$$;
revoke all on function public.end_session(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guest functions: people and requests
-- -----------------------------------------------------------------------------
create function public.require_live_session(p_user_id uuid)
returns public.sessions
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
begin
  s := public.live_session_of(p_user_id);
  if s.id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  return s;
end;
$$;
revoke all on function public.require_live_session(uuid) from public, anon, authenticated;

-- A guest's own visible tag names.
create function public.tag_names(p_user_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array(
    select t.name from public.user_tags ut join public.tags t on t.id = ut.tag_id
    where ut.user_id = p_user_id and not t.is_blocked order by t.name), '{}');
$$;
revoke all on function public.tag_names(uuid) from public, anon, authenticated;

-- Everyone else here now (§4.7). Never user id, nickname, age, gender, phone
-- or location: a card is a handle, interests and where the two stand.
create function public.get_people()
returns table (
  session_id      uuid,
  handle          text,
  tags            text[],
  shared_tags     text[],
  online          boolean,
  chat_state      text,
  request_id      uuid,
  conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := public.require_guest();
  me        public.sessions%rowtype := public.require_live_session(v_user);
  v_my_tags text[] := public.tag_names(v_user);
begin
  return query
    with others as (
      select s.id as sid, s.is_offline as off, s.started_at as since, p.handle as h,
             public.tag_names(s.user_id) as t,
             public.request_between(me.id, s.id) as r
      from public.sessions s
      join public.profiles p on p.id = s.user_id
      where s.venue_id = me.venue_id and s.status <> 'ended' and s.user_id <> v_user
        and not public.is_blocked_pair(v_user, s.user_id)
    ),
    shaped as (
      select o.*, array(select x from unnest(o.t) x where x = any (v_my_tags) order by x) as shared
      from others o
    )
    select sh.sid, sh.h, sh.t, sh.shared, not sh.off,
           case
             when (sh.r).status = 'accepted' then 'chatting'
             when (sh.r).status = 'pending' and (sh.r).from_session_id = me.id then 'request_sent'
             when (sh.r).status = 'pending' then 'request_received'
             when (sh.r).status = 'declined' then 'declined'
             else 'none'
           end,
           case when (sh.r).status = 'pending' then (sh.r).id end,
           case when (sh.r).status = 'accepted' then (sh.r).conversation_id end
    from shaped sh
    order by sh.off, cardinality(sh.shared) desc, sh.since desc;
end;
$$;

-- Requests waiting for this guest's answer.
create function public.get_requests()
returns table (request_id uuid, handle text, tags text[], shared_tags text[], expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := public.require_guest();
  me        public.sessions%rowtype := public.require_live_session(v_user);
  v_my_tags text[] := public.tag_names(v_user);
begin
  return query
    select r.id, p.handle, public.tag_names(r.from_user_id),
           array(select x from unnest(public.tag_names(r.from_user_id)) x where x = any (v_my_tags) order by x),
           r.expires_at
    from public.chat_requests r
    join public.profiles p on p.id = r.from_user_id
    where r.to_session_id = me.id and r.status = 'pending' and r.expires_at > now()
    order by r.created_at desc;
end;
$$;

-- "Say hi" (§4.8). Returns the new request, or the existing conversation if
-- these two visits are already chatting.
create function public.send_chat_request(p_target_session_id uuid)
returns table (request_id uuid, conversation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := public.require_guest();
  me     public.sessions%rowtype;
  them   public.sessions%rowtype;
  r      public.chat_requests%rowtype;
  v_id   uuid;
begin
  perform 1 from public.profiles where id = v_user for update;
  me := public.lock_live_session(v_user);
  if me.id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  select * into them from public.sessions where id = p_target_session_id;
  if not found or them.status = 'ended' then
    raise exception 'TARGET_NOT_AVAILABLE';
  end if;
  if them.user_id = v_user then
    raise exception 'REQUEST_NOT_ALLOWED';
  end if;
  if them.venue_id <> me.venue_id then
    raise exception 'NOT_SAME_VENUE';
  end if;
  if public.is_blocked_pair(v_user, them.user_id) then
    raise exception 'BLOCKED';
  end if;

  r := public.request_between(me.id, them.id);
  if r.status = 'accepted' then
    return query select null::uuid, r.conversation_id;
    return;
  elsif r.status = 'pending' then
    -- If they asked first, the app shows "Accept" instead.
    raise exception 'REQUEST_EXISTS'
      using detail = jsonb_build_object('from_me', r.from_session_id = me.id)::text;
  elsif r.status = 'declined' then
    raise exception 'REQUEST_NOT_ALLOWED';
  end if;

  if (select count(*) from public.chat_requests x where x.from_session_id = me.id and x.status = 'pending')
     >= public.setting_int('MAX_PENDING_OUTGOING_REQUESTS') then
    raise exception 'TOO_MANY_PENDING_REQUESTS';
  end if;
  perform public.check_rate_limit('chat_request:' || me.id, 20, interval '1 hour');

  begin
    insert into public.chat_requests
      (venue_id, from_session_id, to_session_id, from_user_id, to_user_id, expires_at)
    values (me.venue_id, me.id, them.id, v_user, them.user_id,
            now() + make_interval(mins => public.setting_int('CHAT_REQUEST_EXPIRY_MINUTES')))
    returning id into v_id;
  exception when unique_violation then
    -- The other person asked at the same moment.
    raise exception 'REQUEST_EXISTS' using detail = '{"from_me": false}';
  end;

  perform public.notify('user:' || them.user_id::text, 'request.received', jsonb_build_object('request_id', v_id));
  return query select v_id, null::uuid;
end;
$$;

-- Accept or decline. Accepting opens (or reopens) the pair's conversation.
create function public.respond_chat_request(p_request_id uuid, p_accept boolean)
returns table (conversation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := public.require_guest();
  me     public.sessions%rowtype;
  r      public.chat_requests%rowtype;
  v_conv uuid;
  v_next bigint;
begin
  if p_accept is null then
    raise exception 'VALIDATION_FAILED';
  end if;
  perform 1 from public.profiles where id = v_user for update;
  me := public.lock_live_session(v_user);
  if me.id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  select * into r from public.chat_requests where id = p_request_id for update;
  if not found or r.to_user_id <> v_user then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if r.status <> 'pending' or r.expires_at <= now() or r.to_session_id <> me.id then
    raise exception 'REQUEST_NOT_PENDING' using detail = jsonb_build_object('status', r.status)::text;
  end if;

  if not p_accept then
    update public.chat_requests set status = 'declined', responded_at = now() where id = r.id;
    perform public.notify('user:' || r.from_user_id::text, 'request.declined', jsonb_build_object('request_id', r.id));
    return query select null::uuid;
    return;
  end if;

  if public.is_blocked_pair(r.from_user_id, r.to_user_id) then
    raise exception 'BLOCKED';
  end if;
  insert into public.conversations (user_low_id, user_high_id)
  values (least(r.from_user_id, r.to_user_id), greatest(r.from_user_id, r.to_user_id))
  on conflict (user_low_id, user_high_id) do update set updated_at = now()
  returning id into v_conv;

  -- A member who no longer sees the conversation starts from an empty chat;
  -- one who still sees it keeps what they had.
  v_next := coalesce((select max(m.id) from public.messages m where m.conversation_id = v_conv), 0) + 1;
  insert into public.conversation_members as cm (conversation_id, user_id, visible_from_message_id, last_read_message_id)
  select v_conv, u, v_next, v_next - 1 from unnest(array[r.from_user_id, r.to_user_id]) u
  on conflict on constraint conversation_members_pkey do update
    set hidden_at = null,
        visible_from_message_id = excluded.visible_from_message_id,
        last_read_message_id = greatest(cm.last_read_message_id, excluded.last_read_message_id)
    where cm.hidden_at is not null;

  update public.chat_requests
  set status = 'accepted', responded_at = now(), conversation_id = v_conv
  where id = r.id;
  perform public.notify('user:' || r.from_user_id::text, 'request.accepted',
                        jsonb_build_object('request_id', r.id, 'conversation_id', v_conv));
  return query select v_conv;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guest functions: conversations and messages (§4.9)
-- -----------------------------------------------------------------------------
create function public.require_member(p_conversation_id uuid, p_user_id uuid)
returns public.conversation_members
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.conversation_members%rowtype;
begin
  select * into m from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id and hidden_at is null;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;
  return m;
end;
$$;
revoke all on function public.require_member(uuid, uuid) from public, anon, authenticated;

create function public.partner_of(p_conversation_id uuid, p_user_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when c.user_low_id = p_user_id then c.user_high_id else c.user_low_id end
  from public.conversations c where c.id = p_conversation_id;
$$;
revoke all on function public.partner_of(uuid, uuid) from public, anon, authenticated;

create function public.get_conversations()
returns table (
  conversation_id uuid,
  partner_handle  text,
  last_message    text,
  last_message_at timestamptz,
  last_from_me    boolean,
  unread          integer,
  can_send        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := public.require_guest();
begin
  return query
    select c.id, p.handle, lm.body, lm.created_at, lm.sender_user_id = v_user,
           (select count(*)::integer from public.messages x
            where x.conversation_id = c.id and x.sender_user_id <> v_user
              and x.id > m.last_read_message_id and x.id >= m.visible_from_message_id),
           public.can_send(c.id, v_user)
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    join public.profiles p on p.id = public.partner_of(c.id, v_user)
    left join lateral (
      select x.body, x.created_at, x.sender_user_id from public.messages x
      where x.conversation_id = c.id and x.id >= m.visible_from_message_id
      order by x.id desc limit 1
    ) lm on true
    where m.user_id = v_user and m.hidden_at is null
    order by coalesce(lm.created_at, c.created_at) desc;
end;
$$;

-- A page of messages, oldest first. p_before_id pages back through history;
-- p_after_id fetches what arrived after the last one the phone has (resync
-- after a reconnect). At most 100 per call.
create function public.get_messages(
  p_conversation_id uuid,
  p_before_id       bigint  default null,
  p_after_id        bigint  default null,
  p_limit           integer default 50
)
returns table (message_id bigint, from_me boolean, body text, created_at timestamptz, seen boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := public.require_guest();
  m         public.conversation_members%rowtype := public.require_member(p_conversation_id, v_user);
  v_partner uuid := public.partner_of(p_conversation_id, v_user);
  v_seen_to bigint;
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  select pm.last_read_message_id into v_seen_to from public.conversation_members pm
  where pm.conversation_id = p_conversation_id and pm.user_id = v_partner;
  return query
    select page.id, page.sender_user_id = v_user, page.body, page.created_at,
           page.sender_user_id = v_user and page.id <= coalesce(v_seen_to, 0)
    from (
      select x.* from public.messages x
      where x.conversation_id = p_conversation_id
        and x.id >= m.visible_from_message_id
        and (p_before_id is null or x.id < p_before_id)
        and (p_after_id is null or x.id > p_after_id)
      -- After an id: the next ones; otherwise the latest ones.
      order by case when p_after_id is null then -x.id else x.id end
      limit v_limit
    ) page
    order by page.id;
end;
$$;

create function public.send_message(p_conversation_id uuid, p_body text, p_client_msg_id uuid)
returns table (message_id bigint, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := public.require_guest();
  me        public.sessions%rowtype := public.require_live_session(v_user);
  v_partner uuid;
  v_id      bigint;
  v_at      timestamptz;
begin
  -- A retry of a message that already arrived returns it, whatever else changed.
  select x.id, x.created_at into v_id, v_at from public.messages x
  where x.sender_user_id = v_user and x.client_msg_id = p_client_msg_id;
  if found then
    return query select v_id, v_at;
    return;
  end if;

  perform public.require_member(p_conversation_id, v_user);
  v_partner := public.partner_of(p_conversation_id, v_user);
  if public.is_blocked_pair(v_user, v_partner) then
    raise exception 'BLOCKED';
  end if;
  if not public.can_send(p_conversation_id, v_user) then
    raise exception 'CONVERSATION_READ_ONLY';
  end if;
  if p_client_msg_id is null or p_body is null or btrim(p_body) = '' or char_length(p_body) > 1000 then
    raise exception 'MESSAGE_INVALID';
  end if;
  perform public.check_rate_limit('message:' || me.id, 20, interval '10 seconds');

  insert into public.messages (conversation_id, sender_user_id, sender_session_id, client_msg_id, body)
  values (p_conversation_id, v_user, me.id, p_client_msg_id, p_body)
  on conflict on constraint uq_messages_sender_client do nothing
  returning id, created_at into v_id, v_at;
  if v_id is null then
    -- The same message, sent twice at the same moment: return the first.
    select x.id, x.created_at into v_id, v_at from public.messages x
    where x.sender_user_id = v_user and x.client_msg_id = p_client_msg_id;
    return query select v_id, v_at;
    return;
  end if;

  update public.conversations set last_message_at = v_at where id = p_conversation_id;
  perform public.notify('user:' || v_partner::text, 'chat.message', jsonb_build_object(
    'conversation_id', p_conversation_id, 'message_id', v_id, 'body', p_body, 'created_at', v_at));
  return query select v_id, v_at;
end;
$$;

-- "Read up to here": moves only forward, and tells the sender (seen ticks).
create function public.mark_seen(p_conversation_id uuid, p_up_to_message_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.require_guest();
  m       public.conversation_members%rowtype := public.require_member(p_conversation_id, v_user);
  v_up_to bigint;
begin
  v_up_to := least(coalesce(p_up_to_message_id, 0),
                   coalesce((select max(x.id) from public.messages x where x.conversation_id = p_conversation_id), 0));
  if v_up_to <= m.last_read_message_id then
    return;
  end if;
  perform public.check_rate_limit('mark_seen:' || v_user, 60, interval '1 minute');
  update public.conversation_members set last_read_message_id = v_up_to
  where conversation_id = p_conversation_id and user_id = v_user;
  perform public.notify('user:' || public.partner_of(p_conversation_id, v_user)::text, 'chat.seen',
                        jsonb_build_object('conversation_id', p_conversation_id, 'up_to', v_up_to));
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_people', 'get_requests', 'send_chat_request', 'respond_chat_request',
                        'get_conversations', 'get_messages', 'send_message', 'mark_seen')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- tick(): adds step 6, unanswered requests expire
-- -----------------------------------------------------------------------------
create or replace function public.tick()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  r          record;
  v_warned   integer := 0;
  v_final    integer := 0;
  v_expired  integer := 0;
  v_away     integer := 0;
  v_offline  integer := 0;
  v_requests integer := 0;
begin
  -- 1. Warning before the end of the block (notice: sessions_broadcast).
  for r in
    select s.id from public.sessions s
    where s.status = 'active' and s.warning_sent_at is null
      and s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id)) <= now()
    order by s.expires_at
    limit 200
    for update skip locked
  loop
    update public.sessions set warning_sent_at = now() where id = r.id;
    v_warned := v_warned + 1;
  end loop;

  -- 2. Time is up: the final prompt starts.
  for r in
    select s.id from public.sessions s
    where s.status = 'active' and s.expires_at <= now()
    order by s.expires_at
    limit 200
    for update skip locked
  loop
    update public.sessions
    set status            = 'final_prompt',
        final_deadline_at = now() + make_interval(secs => public.setting_int('FINAL_PROMPT_SECONDS')),
        warning_sent_at   = coalesce(warning_sent_at, now())
    where id = r.id;
    v_final := v_final + 1;
  end loop;

  -- 3. Nothing chosen in the final prompt.
  for r in
    select s.id from public.sessions s
    where s.status = 'final_prompt' and s.final_deadline_at <= now()
    order by s.final_deadline_at
    limit 200
    for update skip locked
  loop
    perform public.end_session(r.id, 'expired');
    v_expired := v_expired + 1;
  end loop;

  -- 4. Outside for longer than the away grace.
  for r in
    select s.id from public.sessions s
    where s.status <> 'ended' and s.away_since is not null
      and s.away_since <= now() - make_interval(secs => public.setting_int('AWAY_GRACE_SECONDS', s.venue_id))
    order by s.away_since
    limit 200
    for update skip locked
  loop
    perform public.end_session(r.id, 'left_venue');
    v_away := v_away + 1;
  end loop;

  -- 5. No heartbeat for a while: shown as Offline.
  for r in
    select s.id from public.sessions s
    where s.status <> 'ended' and not s.is_offline
      and s.last_seen_at <= now() - make_interval(secs => public.setting_int('OFFLINE_AFTER_SECONDS'))
    limit 200
    for update skip locked
  loop
    update public.sessions set is_offline = true where id = r.id;
    v_offline := v_offline + 1;
  end loop;

  -- 6. Chat requests nobody answered.
  for r in
    select q.id, q.from_user_id, q.to_user_id from public.chat_requests q
    where q.status = 'pending' and q.expires_at <= now()
    order by q.expires_at
    limit 200
    for update skip locked
  loop
    update public.chat_requests set status = 'expired', responded_at = now() where id = r.id;
    perform public.notify('user:' || r.from_user_id::text, 'request.expired', jsonb_build_object('request_id', r.id));
    perform public.notify('user:' || r.to_user_id::text, 'request.expired', jsonb_build_object('request_id', r.id));
    v_requests := v_requests + 1;
  end loop;

  return jsonb_build_object('warned', v_warned, 'final_prompt', v_final, 'expired', v_expired,
                            'left_venue', v_away, 'offline', v_offline, 'requests_expired', v_requests);
end;
$$;
revoke all on function public.tick() from public, anon, authenticated;
