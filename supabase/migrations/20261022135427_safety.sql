-- =============================================================================
-- Migration safety (M6): block, report (with evidence, also from read-only
-- chats), kick, platform ban, blocked tags and words, evidence expiry.
-- ARCHITECTURE §4.15. Decisions for M6 (all "A"): bans are enforced in the
-- database on every guest call (not through Supabase Auth); reports survive
-- account deletion with a phone-hash snapshot; blocks are permanent; spoof
-- review and live-guest kicks are Console work for M7; a guest can report
-- someone they never chatted with (evidence = handle and interests).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bans apply to every guest call
-- -----------------------------------------------------------------------------
-- A platform-banned guest is refused everywhere at once (BANNED), whatever
-- tokens their phone still holds: every guest function starts here. The
-- login hook and start_session already refuse banned phones and devices.
create or replace function public.require_guest()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id   uuid;
  v_hash text;
begin
  select p.id, p.phone_hash into v_id, v_hash from public.profiles p where p.id = auth.uid();
  if v_id is null then
    raise exception 'NOT_A_GUEST';
  end if;
  if public.active_ban_exists(v_id, v_hash, null) then
    raise exception 'BANNED';
  end if;
  return v_id;
end;
$$;
revoke all on function public.require_guest() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------
create table public.reports (
  id                    uuid        primary key default gen_random_uuid(),
  reporter_id           uuid        references public.profiles (id) on delete set null,
  reported_id           uuid        references public.profiles (id) on delete set null,
  reported_phone_hash   text        not null,
  reported_handle       text        not null,
  reported_session_id   uuid        references public.sessions (id) on delete set null,
  venue_id              uuid        not null references public.venues (id) on delete restrict,
  reason                text        not null,
  note                  text,
  evidence              jsonb,
  evidence_expires_at   timestamptz,
  status                text        not null default 'open',
  action                text,
  reviewed_by           uuid        references public.admins (user_id) on delete set null,
  reviewed_at           timestamptz,
  review_note           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ck_reports_reason   check (reason in ('harassment', 'spam', 'inappropriate', 'other')),
  constraint ck_reports_note     check (note is null or char_length(note) between 1 and 500),
  constraint ck_reports_status   check (status in ('open', 'actioned', 'dismissed')),
  constraint ck_reports_action   check ((status = 'actioned') = (action is not null) and (action is null or action in ('kick', 'ban'))),
  constraint ck_reports_reviewed check ((status = 'open') = (reviewed_at is null)),
  constraint ck_reports_review_note check (review_note is null or char_length(review_note) between 1 and 500),
  constraint ck_reports_evidence check (evidence is null or jsonb_typeof(evidence) = 'object')
);
comment on table public.reports is
  'A guest''s report of another guest. Kept after either account is deleted: safety records outlive accounts.';
comment on column public.reports.reported_id is 'NULL after the reported guest deleted their account; reported_phone_hash still lets a ban land.';
comment on column public.reports.reported_phone_hash is 'Snapshot at report time, so the person can be banned even after deleting the account.';
comment on column public.reports.reported_handle is 'Snapshot at report time, for the Console.';
comment on column public.reports.reported_session_id is 'Their session when reported, to kick the right visit.';
comment on column public.reports.evidence is
  'Opaque snapshot for review: the reported handle and interests, and the last messages the reporter could see. Erased at evidence_expires_at.';

create index ix_reports_status_created on public.reports (status, created_at desc);
create index ix_reports_reporter       on public.reports (reporter_id, created_at desc);
create index ix_reports_reported       on public.reports (reported_id);
create index ix_reports_venue          on public.reports (venue_id);
create index ix_reports_session        on public.reports (reported_session_id);
create index ix_reports_reviewed_by    on public.reports (reviewed_by);
create index ix_reports_evidence_expiry on public.reports (evidence_expires_at) where evidence is not null;

create trigger trg_reports_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;
revoke all on table public.reports from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Blocking (§4.15)
-- -----------------------------------------------------------------------------
-- The guest a block or report is about, as the caller can see them: a live
-- session at the caller's venue (People card) or a conversation the caller
-- still sees (also read-only, after the other person left). Exactly one.
create function public.safety_target(p_user_id uuid, p_session_id uuid, p_conversation_id uuid)
returns table (target_id uuid, session_id uuid, venue_id uuid, conversation_id uuid)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  me   public.sessions%rowtype := public.live_session_of(p_user_id);
  them public.sessions%rowtype;
begin
  if (p_session_id is null) = (p_conversation_id is null) then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"target"}';
  end if;
  if p_session_id is not null then
    select * into them from public.sessions s where s.id = p_session_id;
    if not found or them.status = 'ended' or me.id is null or them.venue_id <> me.venue_id
       or them.user_id = p_user_id then
      raise exception 'TARGET_NOT_AVAILABLE';
    end if;
    target_id := them.user_id;
    session_id := them.id;
    venue_id := them.venue_id;
    conversation_id := (select c.id from public.conversations c
                        where c.user_low_id = least(p_user_id, them.user_id)
                          and c.user_high_id = greatest(p_user_id, them.user_id));
  else
    perform public.require_member(p_conversation_id, p_user_id);
    target_id := public.partner_of(p_conversation_id, p_user_id);
    them := public.live_session_of(target_id);
    session_id := them.id;
    venue_id := coalesce(me.venue_id, them.venue_id);
    conversation_id := p_conversation_id;
  end if;
  return next;
end;
$$;
revoke all on function public.safety_target(uuid, uuid, uuid) from public, anon, authenticated;

-- Blocks p_blocked for p_blocker, for good (decision: no unblock in V1):
-- pending requests between them end, their conversation is deleted on both
-- sides, and both are told so their screens drop the other at once.
create function public.apply_block(p_blocker uuid, p_blocked uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  r record;
begin
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked)
  on conflict do nothing;

  for r in
    update public.chat_requests
    set status = 'cancelled', responded_at = now()
    where status = 'pending'
      and ((from_user_id = p_blocker and to_user_id = p_blocked)
        or (from_user_id = p_blocked and to_user_id = p_blocker))
    returning id
  loop
    perform public.notify('user:' || p_blocker::text, 'request.cancelled', jsonb_build_object('request_id', r.id));
    perform public.notify('user:' || p_blocked::text, 'request.cancelled', jsonb_build_object('request_id', r.id));
  end loop;

  for r in
    delete from public.conversations c
    where c.user_low_id = least(p_blocker, p_blocked) and c.user_high_id = greatest(p_blocker, p_blocked)
    returning c.id
  loop
    perform public.notify('user:' || p_blocker::text, 'chat.closed', jsonb_build_object('conversation_id', r.id));
    perform public.notify('user:' || p_blocked::text, 'chat.closed', jsonb_build_object('conversation_id', r.id));
  end loop;

  -- No handle or reason: the blocked guest learns only that someone left their list.
  perform public.notify('user:' || p_blocker::text, 'person.removed', '{}'::jsonb);
  perform public.notify('user:' || p_blocked::text, 'person.removed', '{}'::jsonb);
end;
$$;
revoke all on function public.apply_block(uuid, uuid) from public, anon, authenticated;

create function public.block_person(p_session_id uuid default null, p_conversation_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
  t      record;
begin
  perform public.check_rate_limit('block:' || v_user, 30, interval '1 hour');
  select * into t from public.safety_target(v_user, p_session_id, p_conversation_id);
  perform public.apply_block(v_user, t.target_id);
end;
$$;

-- Reports and blocks (§4.15). The evidence is what the reporter could see:
-- the last REPORT_EVIDENCE_MESSAGES messages of their chat with this person
-- (read-only chats included), plus the person's handle and interests.
create function public.report_person(
  p_reason          text,
  p_note            text default null,
  p_session_id      uuid default null,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user     uuid := public.require_guest();
  t          record;
  v_target   public.profiles%rowtype;
  v_note     text := nullif(btrim(p_note), '');
  v_messages jsonb := null;
  v_from     bigint;
  v_id       uuid;
begin
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"reason"}';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  perform public.check_rate_limit('report:' || v_user, 5, interval '1 day');
  select * into t from public.safety_target(v_user, p_session_id, p_conversation_id);
  if t.venue_id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  select * into v_target from public.profiles where id = t.target_id;

  if t.conversation_id is not null and public.setting_bool('REPORT_EVIDENCE_ENABLED') then
    select m.visible_from_message_id into v_from from public.conversation_members m
    where m.conversation_id = t.conversation_id and m.user_id = v_user and m.hidden_at is null;
    if found then
      select coalesce(jsonb_agg(jsonb_build_object(
               'from', case when x.sender_user_id = v_user then 'reporter' else 'reported' end,
               'body', x.body,
               'at', x.created_at) order by x.id), '[]'::jsonb)
      into v_messages
      from (
        select * from public.messages y
        where y.conversation_id = t.conversation_id and y.id >= v_from
        order by y.id desc
        limit public.setting_int('REPORT_EVIDENCE_MESSAGES')
      ) x;
    end if;
  end if;

  insert into public.reports (
    reporter_id, reported_id, reported_phone_hash, reported_handle, reported_session_id, venue_id,
    reason, note, evidence, evidence_expires_at)
  values (
    v_user, v_target.id, v_target.phone_hash, v_target.handle, t.session_id, t.venue_id,
    p_reason, v_note,
    jsonb_build_object('handle', v_target.handle, 'tags', to_jsonb(public.tag_names(v_target.id)),
                       'messages', v_messages),
    now() + make_interval(days => public.setting_int('REPORT_EVIDENCE_RETENTION_DAYS')))
  returning id into v_id;

  -- After the evidence is copied: blocking deletes the conversation.
  perform public.apply_block(v_user, t.target_id);
  perform public.notify('admin', 'report.new', jsonb_build_object('report_id', v_id));
  return v_id;
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('block_person', 'report_person')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Kicks and bans
-- -----------------------------------------------------------------------------
-- Keeps a guest out of one venue for KICK_COOLDOWN_HOURS, and ends their
-- visit there if they are in one. Matched by account, phone and device.
create function public.kick_guest(
  p_user_id    uuid,
  p_phone_hash text,
  p_venue_id   uuid,
  p_reason     text,
  p_admin_id   uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
begin
  if p_user_id is not null then
    s := public.lock_live_session(p_user_id);
  end if;
  insert into public.bans (scope, venue_id, user_id, phone_hash, device_id, reason, expires_at, created_by)
  values ('venue', p_venue_id, p_user_id, p_phone_hash,
          case when s.venue_id = p_venue_id then s.device_id end,
          p_reason, now() + make_interval(hours => public.setting_int('KICK_COOLDOWN_HOURS')), p_admin_id);
  if s.id is not null and s.venue_id = p_venue_id then
    perform public.end_session(s.id, 'kicked');
  end if;
end;
$$;
revoke all on function public.kick_guest(uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- Bans a guest from the whole platform (p_days NULL = permanent): matched by
-- account, phone and their last device; any live visit ends at once.
create function public.ban_guest(
  p_user_id    uuid,
  p_phone_hash text,
  p_days       integer,
  p_reason     text,
  p_admin_id   uuid
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  s        public.sessions%rowtype;
  v_device text;
  v_id     uuid;
begin
  if p_days is not null and p_days not between 1 and 3650 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"days"}';
  end if;
  if p_user_id is not null then
    s := public.lock_live_session(p_user_id);
    select x.device_id into v_device from public.sessions x
    where x.user_id = p_user_id and x.device_id is not null
    order by x.started_at desc limit 1;
  end if;
  insert into public.bans (scope, user_id, phone_hash, device_id, reason, expires_at, created_by)
  values ('platform', p_user_id, p_phone_hash, v_device, p_reason,
          case when p_days is null then null else now() + make_interval(days => p_days) end, p_admin_id)
  returning id into v_id;
  if s.id is not null then
    perform public.end_session(s.id, 'banned');
  end if;
  return v_id;
end;
$$;
revoke all on function public.ban_guest(uuid, text, integer, text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Admin: reports
-- -----------------------------------------------------------------------------
create function public.admin_list_reports(p_status text default 'open', p_limit integer default 100)
returns table (
  report_id       uuid,
  created_at      timestamptz,
  status          text,
  action          text,
  reason          text,
  note            text,
  venue_name      text,
  reporter_handle text,
  reported_handle text,
  reported_live   boolean,
  has_evidence    boolean,
  reviewed_at     timestamptz,
  review_note     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select r.id, r.created_at, r.status, r.action, r.reason, r.note, v.name, rp.handle, r.reported_handle,
           exists (select 1 from public.sessions s where s.user_id = r.reported_id and s.status <> 'ended'),
           r.evidence is not null, r.reviewed_at, r.review_note
    from public.reports r
    join public.venues v on v.id = r.venue_id
    left join public.profiles rp on rp.id = r.reporter_id
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create function public.admin_report_evidence(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_evidence jsonb;
begin
  perform public.require_admin();
  select r.evidence into v_evidence from public.reports r where r.id = p_report_id;
  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  return v_evidence;
end;
$$;

-- Closes an open report: dismiss, kick (out of the report's venue for
-- KICK_COOLDOWN_HOURS, even if they already left), or ban (p_days NULL =
-- permanent). Every decision needs a note and is audit-logged.
create function public.admin_resolve_report(
  p_report_id uuid,
  p_decision  text,
  p_note      text,
  p_ban_days  integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r      public.reports%rowtype;
  v_note text := btrim(p_note);
begin
  perform public.require_admin();
  if p_decision is null or p_decision not in ('dismiss', 'kick', 'ban') then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"decision"}';
  end if;
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  -- Lock order profile → session (§9): the report row is locked last.
  select * into r from public.reports where id = p_report_id;
  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  if r.reported_id is not null then
    perform 1 from public.profiles where id = r.reported_id for update;
  end if;
  select * into r from public.reports where id = p_report_id for update;
  if r.status <> 'open' then
    raise exception 'REPORT_ALREADY_RESOLVED';
  end if;

  if p_decision = 'kick' then
    perform public.kick_guest(r.reported_id, r.reported_phone_hash, r.venue_id, 'report:' || r.id, auth.uid());
  elsif p_decision = 'ban' then
    perform public.ban_guest(r.reported_id, r.reported_phone_hash, p_ban_days, 'report:' || r.id, auth.uid());
  end if;

  update public.reports
  set status = case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end,
      action = case when p_decision = 'dismiss' then null else p_decision end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where id = r.id;
  perform public.write_audit('admin', auth.uid(), 'report.' || p_decision, 'report', r.id, r.venue_id,
    jsonb_build_object('note', v_note, 'ban_days', p_ban_days));
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: bans
-- -----------------------------------------------------------------------------
create function public.admin_ban_guest(p_user_id uuid, p_days integer, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_note text := btrim(p_note);
  v_id   uuid;
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select p.phone_hash into v_hash from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'NOT_A_GUEST';
  end if;
  v_id := public.ban_guest(p_user_id, v_hash, p_days, 'admin: ' || v_note, auth.uid());
  perform public.write_audit('admin', auth.uid(), 'ban.create', 'guest', p_user_id, null,
    jsonb_build_object('ban_id', v_id, 'days', p_days, 'note', v_note));
  return v_id;
end;
$$;

create function public.admin_list_bans(p_active_only boolean default true)
returns table (
  ban_id       uuid,
  scope        text,
  venue_name   text,
  guest_handle text,
  reason       text,
  created_at   timestamptz,
  expires_at   timestamptz,
  lifted_at    timestamptz,
  created_by   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select b.id, b.scope, v.name, g.handle, b.reason, b.created_at, b.expires_at, b.lifted_at, a.email
    from public.bans b
    left join public.venues v on v.id = b.venue_id
    left join public.profiles g on g.id = b.user_id
    left join public.admins a on a.user_id = b.created_by
    where not coalesce(p_active_only, true)
       or (b.lifted_at is null and (b.expires_at is null or b.expires_at > now()))
    order by b.created_at desc
    limit 500;
end;
$$;

create function public.admin_lift_ban(p_ban_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(p_note);
  b      public.bans%rowtype;
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  update public.bans set lifted_at = now(), lifted_by = auth.uid()
  where id = p_ban_id and lifted_at is null
  returning * into b;
  if not found then
    raise exception 'BAN_NOT_FOUND';
  end if;
  perform public.write_audit('admin', auth.uid(), 'ban.lift', 'ban', b.id, b.venue_id,
    jsonb_build_object('note', v_note, 'scope', b.scope));
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: blocked tags and words
-- -----------------------------------------------------------------------------
create function public.admin_list_tags(p_query text default '')
returns table (name text, users integer, is_blocked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_prefix text := public.normalize_tag(p_query);
begin
  perform public.require_admin();
  return query
    select t.name, count(ut.user_id)::integer, t.is_blocked
    from public.tags t
    left join public.user_tags ut on ut.tag_id = t.id
    where v_prefix is null or t.name like v_prefix || '%'
    group by t.name, t.is_blocked
    order by t.is_blocked desc, count(ut.user_id) desc, t.name
    limit 100;
end;
$$;

-- A blocked tag disappears from every card and suggestion at once
-- (tag_names / tag_suggestions skip it) and can no longer be chosen.
create function public.admin_set_tag_blocked(p_name text, p_blocked boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_blocked is null then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"blocked"}';
  end if;
  update public.tags set is_blocked = p_blocked where name = p_name;
  if not found then
    raise exception 'TAG_NOT_FOUND';
  end if;
  perform public.write_audit('admin', auth.uid(), case when p_blocked then 'tag.block' else 'tag.unblock' end,
    null, null, null, jsonb_build_object('tag', p_name));
end;
$$;

create function public.admin_list_blocked_terms()
returns table (term text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query select b.term, b.created_at from public.blocked_terms b order by b.term;
end;
$$;

-- Words no new tag may contain as a whole word. Applies to tags chosen from
-- now on; a tag already in use is blocked with admin_set_tag_blocked.
create function public.admin_add_blocked_term(p_term text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_term text := public.normalize_tag(p_term);
begin
  perform public.require_admin();
  if v_term is null then
    raise exception 'TAG_INVALID';
  end if;
  insert into public.blocked_terms (term, created_by) values (v_term, auth.uid()) on conflict do nothing;
  perform public.write_audit('admin', auth.uid(), 'blocked_term.add', null, null, null, jsonb_build_object('term', v_term));
  return v_term;
end;
$$;

create function public.admin_remove_blocked_term(p_term text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.blocked_terms where term = p_term;
  if not found then
    raise exception 'TAG_NOT_FOUND';
  end if;
  perform public.write_audit('admin', auth.uid(), 'blocked_term.remove', null, null, null, jsonb_build_object('term', p_term));
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_list_reports', 'admin_report_evidence', 'admin_resolve_report', 'admin_ban_guest',
                        'admin_list_bans', 'admin_lift_ban', 'admin_list_tags', 'admin_set_tag_blocked',
                        'admin_list_blocked_terms', 'admin_add_blocked_term', 'admin_remove_blocked_term')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Live channel for the Console: admin (new reports)
-- -----------------------------------------------------------------------------
create or replace function public.realtime_topic_allowed(p_topic text, p_send boolean)
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
  -- Admins (aal2) listen for new reports; nobody sends on it but the server.
  if p_topic = 'admin' then
    return not p_send and public.is_admin();
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

-- -----------------------------------------------------------------------------
-- Hourly clean-up: report evidence past its retention
-- -----------------------------------------------------------------------------
create or replace function public.hourly_cleanup()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rate     integer;
  v_sms      integer;
  v_cron     integer;
  v_payments integer;
  v_evidence integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;
  delete from public.sms_log where created_at < now() - interval '30 days';
  get diagnostics v_sms = row_count;
  delete from cron.job_run_details where end_time < now() - interval '1 day';
  get diagnostics v_cron = row_count;
  -- A checkout nobody finished in 24 h is over (§4.10). A late success is
  -- still applied by apply_payment.
  update public.payments set status = 'failed', failed_at = now()
  where status = 'created' and created_at < now() - interval '24 hours';
  get diagnostics v_payments = row_count;
  -- Report evidence (message copies) is kept REPORT_EVIDENCE_RETENTION_DAYS (§11).
  update public.reports set evidence = null
  where evidence is not null and evidence_expires_at < now();
  get diagnostics v_evidence = row_count;
  return jsonb_build_object('rate_limits', v_rate, 'sms_log', v_sms, 'cron_history', v_cron,
                            'payments_failed', v_payments, 'evidence_erased', v_evidence);
end;
$$;
revoke all on function public.hourly_cleanup() from public, anon, authenticated;
