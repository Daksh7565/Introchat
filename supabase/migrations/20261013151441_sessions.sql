-- =============================================================================
-- Migration sessions (M3): a guest's visit to a venue, the timer, presence and
-- location while inside, and the 10-second tick that drives warnings, expiry,
-- away and offline. ARCHITECTURE §3.3, §3.4, §4.5, §4.6, §4.11–4.13, §5.1, §8.
--
-- Not here yet: chat clean-up and Realtime broadcasts at session end (M4),
-- payments, scan credits and the free resume of paid sessions (M5), kicks and
-- bans of live sessions (M6). end_session() is the one place those plug in.
-- =============================================================================

create table public.sessions (
  id                  uuid         primary key default gen_random_uuid(),
  user_id             uuid         not null references public.profiles (id) on delete cascade,
  venue_id            uuid         not null references public.venues (id) on delete restrict,
  table_id            uuid         references public.tables (id) on delete set null,
  kind                text         not null,
  status              text         not null default 'active',
  started_at          timestamptz  not null default now(),
  block_started_at    timestamptz  not null default now(),
  expires_at          timestamptz  not null,
  warning_sent_at     timestamptz,
  final_deadline_at   timestamptz,
  payment_grace_used  boolean      not null default false,
  last_seen_at        timestamptz  not null default now(),
  is_offline          boolean      not null default false,
  location_state      text         not null,
  location_checked_at timestamptz,
  away_since          timestamptz,
  last_lat            numeric(9,6),
  last_lng            numeric(9,6),
  last_taken_at       timestamptz,
  same_reading_count  smallint     not null default 0,
  start_distance_m    integer,
  start_accuracy_m    integer,
  spoof_flags         jsonb        not null default '[]'::jsonb,
  resumed_from        uuid         references public.sessions (id) on delete set null,
  device_id           text,
  ended_at            timestamptz,
  end_reason          text,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),
  constraint ck_sessions_kind       check (kind in ('free', 'paid_scan', 'subscription')),
  constraint ck_sessions_status     check (status in ('active', 'final_prompt', 'ended')),
  constraint ck_sessions_location   check (location_state in ('inside', 'outside', 'unknown')),
  constraint ck_sessions_end_reason check (end_reason is null or end_reason in
    ('expired', 'left_venue', 'user_logout', 'kicked', 'banned', 'venue_closed')),
  constraint ck_sessions_ended      check ((status = 'ended') = (ended_at is not null)
                                           and (status = 'ended') = (end_reason is not null)),
  constraint ck_sessions_final      check ((status = 'final_prompt') = (final_deadline_at is not null)),
  constraint ck_sessions_spoof      check (jsonb_typeof(spoof_flags) = 'array'),
  constraint uq_sessions_resumed_from unique (resumed_from)
);
comment on table public.sessions is
  'One guest visit to one venue. Live = status active or final_prompt; at most one per guest.';
comment on column public.sessions.kind is 'What pays for the current block of time (ARCHITECTURE §5.1).';
comment on column public.sessions.block_started_at is 'Start of the current block; a subscription upgrade counts 2 h from here (M5).';
comment on column public.sessions.is_offline is
  'No heartbeat for OFFLINE_AFTER_SECONDS. A flag shown to others, not an end: a locked phone keeps its session.';
comment on column public.sessions.away_since is 'First outside reading of the current run; NULL while inside or unknown.';
comment on column public.sessions.last_lat is
  'Previous reading, kept on the live session only for the spoof checks (§3.4). Wiped by end_session.';
comment on column public.sessions.same_reading_count is
  'How many readings in a row repeated the exact previous position (real GPS always moves a little).';
comment on column public.sessions.spoof_flags is 'Signals for admin review, never an automatic ban: [{"type", "at", ...}].';

create unique index uq_sessions_one_live_per_user on public.sessions (user_id) where status <> 'ended';
create index ix_sessions_venue_live    on public.sessions (venue_id) where status <> 'ended';
create index ix_sessions_tick_active   on public.sessions (expires_at) where status = 'active';
create index ix_sessions_tick_final    on public.sessions (final_deadline_at) where status = 'final_prompt';
create index ix_sessions_away          on public.sessions (away_since) where status <> 'ended' and away_since is not null;
create index ix_sessions_seen          on public.sessions (last_seen_at) where status <> 'ended' and not is_offline;
create index ix_sessions_user_started  on public.sessions (user_id, started_at desc);
create index ix_sessions_table         on public.sessions (table_id);

create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;
revoke all on table public.sessions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- What the app receives about a session
-- -----------------------------------------------------------------------------
-- One shape for every session call, so the phone always has the full picture:
-- the times it counts down to, the rules it needs to show the right popup,
-- and server_now to correct for a phone clock that is off.
create type public.session_state as (
  session_id            uuid,
  status                text,
  end_reason            text,
  kind                  text,
  venue_name            text,
  table_label           text,
  started_at            timestamptz,
  expires_at            timestamptz,
  warning_at            timestamptz,
  final_deadline_at     timestamptz,
  final_prompt_seconds  integer,
  away_since            timestamptz,
  away_grace_seconds    integer,
  payments_enabled      boolean,
  continue_free_minutes integer,
  heartbeat_seconds     integer,
  location_seconds      integer,
  server_now            timestamptz
);

create function public.session_state_of(p_session_id uuid)
returns public.session_state
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
  r public.session_state;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  r.session_id            := s.id;
  r.status                := s.status;
  r.end_reason            := s.end_reason;
  r.kind                  := s.kind;
  r.venue_name            := (select v.name from public.venues v where v.id = s.venue_id);
  r.table_label           := (select t.label from public.tables t where t.id = s.table_id);
  r.started_at            := s.started_at;
  r.expires_at            := s.expires_at;
  r.warning_at            := s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id));
  r.final_deadline_at     := s.final_deadline_at;
  r.final_prompt_seconds  := public.setting_int('FINAL_PROMPT_SECONDS');
  r.away_since            := s.away_since;
  r.away_grace_seconds    := public.setting_int('AWAY_GRACE_SECONDS', s.venue_id);
  r.payments_enabled      := public.setting_bool('PAYMENTS_ENABLED', s.venue_id);
  r.continue_free_minutes := public.setting_int('FREE_SESSION_MINUTES', s.venue_id);
  r.heartbeat_seconds     := public.setting_int('HEARTBEAT_INTERVAL_SECONDS');
  r.location_seconds      := public.setting_int('LOCATION_INTERVAL_SECONDS');
  -- The wall clock at the moment of answering, not the transaction start.
  r.server_now            := clock_timestamp();
  return r;
end;
$$;
revoke all on function public.session_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- end_session: the single exit path (ARCHITECTURE §4.13)
-- -----------------------------------------------------------------------------
-- Idempotent. Every way a session ends comes through here, so later
-- milestones add their clean-up in one place: chats and Realtime notices
-- (M4), keeping a subscriber's history (M5).
create function public.end_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
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

  if p_reason in ('kicked', 'banned', 'venue_closed') then
    perform public.write_audit('system', null, 'session.end', 'session', s.id, s.venue_id,
                               jsonb_build_object('reason', p_reason));
  end if;
end;
$$;
revoke all on function public.end_session(uuid, text) from public, anon, authenticated;

-- The caller's live session, locked; NULL if none.
create function public.lock_live_session(p_user_id uuid)
returns public.sessions
language sql
volatile
set search_path = ''
as $$
  select * from public.sessions where user_id = p_user_id and status <> 'ended' for update;
$$;
revoke all on function public.lock_live_session(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guest functions
-- -----------------------------------------------------------------------------

-- The session the home screen shows: the live one, or one that ended in the
-- last 30 minutes (so a guest reopening the app learns why it ended). No row
-- = nothing to show; the app asks them to scan.
create function public.my_session()
returns setof public.session_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
  v_id   uuid;
begin
  select s.id into v_id
  from public.sessions s
  where s.user_id = v_user
    and (s.status <> 'ended' or s.ended_at > now() - interval '30 minutes')
  order by s.started_at desc
  limit 1;
  if v_id is not null then
    return next public.session_state_of(v_id);
  end if;
end;
$$;

-- Starts (or returns) the guest's session at the scanned table (§4.5). The
-- location is evaluated again here; the landing page's check is not trusted.
-- Payments (M5): while the scan fee is on for this venue every start is
-- refused with PAYMENT_REQUIRED, so no one gets in free by mistake.
create function public.start_session(
  p_slug        text,
  p_qr_token    text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision,
  p_device_id   text
)
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user    uuid := public.require_guest();
  v_profile public.profiles%rowtype;
  v_scan    record;
  v_loc     record;
  v_live    public.sessions%rowtype;
  v_until   timestamptz;
  v_minutes integer;
  v_taken   timestamptz;
  v_id      uuid;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'DEVICE_ID_INVALID';
  end if;
  perform public.check_rate_limit('start_session:' || v_user, 20, interval '1 minute');

  -- Lock order profile → session (§9). Holding the profile lock also means two
  -- tabs starting at once run one after the other: the second finds the first's
  -- session and returns it.
  select * into v_profile from public.profiles where id = v_user for update;
  select * into v_scan from public.resolve_scan(p_slug, p_qr_token);

  if v_profile.age_blocked then
    raise exception 'AGE_BLOCKED';
  end if;
  if v_profile.consent_version is distinct from (public.setting('CONSENT_VERSION') #>> '{}') then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if v_profile.birth_year is null
     or not exists (select 1 from public.user_tags ut where ut.user_id = v_user) then
    raise exception 'PROFILE_INCOMPLETE';
  end if;
  if public.active_ban_exists(v_user, v_profile.phone_hash, p_device_id) then
    raise exception 'BANNED';
  end if;
  select max(coalesce(b.expires_at, 'infinity')) into v_until
  from public.bans b
  where b.scope = 'venue' and b.venue_id = v_scan.venue_id and b.lifted_at is null
    and (b.expires_at is null or b.expires_at > now())
    and (b.user_id = v_user or b.phone_hash = v_profile.phone_hash or b.device_id = p_device_id);
  if v_until is not null then
    raise exception 'KICKED_COOLDOWN' using detail = jsonb_build_object('until', v_until)::text;
  end if;

  select * into v_loc
  from public.evaluate_location(v_scan.venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds);
  if v_loc.state = 'outside' then
    raise exception 'NOT_AT_VENUE';
  elsif v_loc.state = 'unknown' then
    raise exception 'LOCATION_INACCURATE';
  end if;

  v_live := public.lock_live_session(v_user);
  if v_live.id is not null then
    -- Reload or a second scan at the same venue: same session, same timer.
    if v_live.venue_id = v_scan.venue_id then
      return public.session_state_of(v_live.id);
    end if;
    perform public.end_session(v_live.id, 'left_venue');
  end if;

  if public.setting_bool('PAYMENTS_ENABLED', v_scan.venue_id)
     and public.setting_bool('SCAN_FEE_ENABLED', v_scan.venue_id) then
    raise exception 'PAYMENT_REQUIRED' using detail = jsonb_build_object(
      'scan_fee_paise', public.setting_int('SCAN_FEE_PAISE', v_scan.venue_id),
      'subscription_price_paise', public.setting_int('SUBSCRIPTION_PRICE_PAISE'),
      'subscription_on', public.setting_bool('SUBSCRIPTION_ENABLED', v_scan.venue_id))::text;
  end if;

  v_minutes := public.setting_int('FREE_SESSION_MINUTES', v_scan.venue_id);
  v_taken   := now() - make_interval(secs => greatest(p_age_seconds, 0));
  insert into public.sessions (
    user_id, venue_id, table_id, kind, status, started_at, block_started_at, expires_at,
    last_seen_at, location_state, location_checked_at, last_lat, last_lng, last_taken_at,
    start_distance_m, start_accuracy_m, device_id)
  values (
    v_user, v_scan.venue_id, v_scan.table_id, 'free', 'active', now(), now(),
    now() + make_interval(mins => v_minutes),
    now(), 'inside', v_taken, p_latitude, p_longitude, v_taken,
    v_loc.distance_m, round(p_accuracy_m)::integer, p_device_id)
  returning id into v_id;
  return public.session_state_of(v_id);
end;
$$;

-- "Still here", every HEARTBEAT_INTERVAL_SECONDS while the app is open, and at
-- once when it comes back to the screen (§4.6). Carries the latest reading if
-- the phone has one. Returns the session's state; if it is no longer live
-- (ended by the tick, or by this heartbeat), the ended state with its reason.
create function public.heartbeat(
  p_latitude    double precision default null,
  p_longitude   double precision default null,
  p_accuracy_m  double precision default null,
  p_age_seconds double precision default null,
  p_permission  text             default 'granted'
)
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user        uuid := public.require_guest();
  s             public.sessions%rowtype;
  v_last        uuid;
  v_was_offline boolean;
  v_state       text;
  v_loc         record;
  v_taken       timestamptz;
  v_flags       jsonb := '[]'::jsonb;
  v_same        smallint;
  v_seconds     double precision;
  v_speed       double precision;
begin
  if p_permission is null or p_permission not in ('granted', 'denied', 'prompt') then
    raise exception 'PERMISSION_STATE_INVALID';
  end if;
  -- Twice the normal rate, for heartbeats sent on returning to the screen.
  perform public.check_rate_limit('heartbeat:' || v_user, 12, interval '1 minute');

  s := public.lock_live_session(v_user);
  if s.id is null then
    select x.id into v_last from public.sessions x
    where x.user_id = v_user order by x.started_at desc limit 1;
    if v_last is null then
      raise exception 'SESSION_NOT_ACTIVE';
    end if;
    return public.session_state_of(v_last);
  end if;

  -- Offline by the flag, or by time even if the tick has not flagged it yet.
  v_was_offline := s.is_offline
    or s.last_seen_at < now() - make_interval(secs => public.setting_int('OFFLINE_AFTER_SECONDS'));

  if p_permission = 'denied' then
    -- Location switched off mid-visit counts as outside (§3.1).
    v_state := 'outside';
  elsif p_latitude is not null then
    v_taken := now() - make_interval(secs => greatest(coalesce(p_age_seconds, 0), 0));
    -- Only a reading newer than the last evaluated one says anything new.
    if s.location_checked_at is null or v_taken > s.location_checked_at + interval '1 second' then
      select * into v_loc
      from public.evaluate_location(s.venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds);
      v_state := v_loc.state;

      -- Spoof signals (§3.4): recorded for review, never acted on automatically.
      if p_accuracy_m = 0 then
        v_flags := v_flags || jsonb_build_object('type', 'zero_accuracy', 'at', now());
      end if;
      if s.last_lat is not null and s.last_taken_at is not null and v_taken > s.last_taken_at then
        v_seconds := extract(epoch from v_taken - s.last_taken_at);
        v_speed := public.haversine_m(s.last_lat, s.last_lng, p_latitude, p_longitude) / v_seconds;
        if v_speed > public.setting_int('MAX_SPEED_MPS') then
          v_flags := v_flags || jsonb_build_object('type', 'speed', 'at', now(), 'mps', round(v_speed::numeric, 1));
        end if;
      end if;
      if s.last_lat = round(p_latitude::numeric, 6) and s.last_lng = round(p_longitude::numeric, 6) then
        v_same := s.same_reading_count + 1;
      else
        v_same := 0;
      end if;
      -- Flag once, when the 5th identical reading in a row arrives.
      if v_same = 4 then
        v_flags := v_flags || jsonb_build_object('type', 'repeated_position', 'at', now());
      end if;

      update public.sessions
      set location_checked_at = v_taken,
          last_lat            = p_latitude,
          last_lng            = p_longitude,
          last_taken_at       = v_taken,
          same_reading_count  = v_same,
          -- Capped so a misbehaving phone cannot grow the row without limit.
          spoof_flags         = case when jsonb_array_length(spoof_flags) < 50
                                     then spoof_flags || v_flags else spoof_flags end
      where id = s.id;
    end if;
  end if;

  -- Came back after being offline and the first answer is "outside": the
  -- guest left while the phone was locked (§3.3). No away grace.
  if v_state = 'outside' and v_was_offline then
    perform public.end_session(s.id, 'left_venue');
    return public.session_state_of(s.id);
  end if;

  update public.sessions
  set last_seen_at   = now(),
      is_offline     = false,
      location_state = coalesce(v_state, location_state),
      away_since     = case v_state
                         when 'outside' then coalesce(away_since, now())
                         when 'inside'  then null
                         else away_since -- unknown or no new reading: no change
                       end
  where id = s.id;
  return public.session_state_of(s.id);
end;
$$;

-- "Continue free" in the warning or the final popup, while payments are off
-- for this venue (§4.11). Adds a new block from the current end (or from now,
-- if already in the final prompt).
create function public.continue_free()
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.require_guest();
  s       public.sessions%rowtype;
  v_start timestamptz;
begin
  perform 1 from public.profiles where id = v_user for update;
  s := public.lock_live_session(v_user);
  if s.id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  if public.setting_bool('PAYMENTS_ENABLED', s.venue_id) then
    raise exception 'FEATURE_DISABLED';
  end if;
  -- Only from the warning onwards, so the timer cannot be topped up at will.
  if s.status = 'active'
     and now() < s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id)) then
    raise exception 'CONTINUE_NOT_AVAILABLE';
  end if;

  v_start := greatest(s.expires_at, now());
  update public.sessions
  set kind               = 'free',
      status             = 'active',
      block_started_at   = v_start,
      expires_at         = v_start + make_interval(mins => public.setting_int('FREE_SESSION_MINUTES', s.venue_id)),
      warning_sent_at    = null,
      final_deadline_at  = null,
      payment_grace_used = false
  where id = s.id;
  return public.session_state_of(s.id);
end;
$$;

-- "Log out" from the session: ends it now. Returns the ended state; calling it
-- again (a double tap, a retry) returns the same ended state.
create function public.end_my_session()
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
  s      public.sessions%rowtype;
  v_last uuid;
begin
  perform 1 from public.profiles where id = v_user for update;
  s := public.lock_live_session(v_user);
  if s.id is not null then
    perform public.end_session(s.id, 'user_logout');
    return public.session_state_of(s.id);
  end if;
  select x.id into v_last from public.sessions x
  where x.user_id = v_user order by x.started_at desc limit 1;
  if v_last is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  return public.session_state_of(v_last);
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
      and p.proname in ('my_session', 'start_session', 'heartbeat', 'continue_free', 'end_my_session')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- tick(): every 10 seconds (§4.12, §8)
-- -----------------------------------------------------------------------------
-- Each step takes due rows with FOR UPDATE SKIP LOCKED (a row a guest is
-- changing right now is simply picked up on the next tick), at most 200 per
-- step. Postgres re-checks the WHERE clause on each row it locks, so a session
-- continued a moment earlier is not ended. Returns what it did, for tests and
-- for reading the cron history.
create function public.tick()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  r         record;
  v_warned  integer := 0;
  v_final   integer := 0;
  v_expired integer := 0;
  v_away    integer := 0;
  v_offline integer := 0;
begin
  -- 1. Warning before the end of the block. (M4: Realtime notice + push.)
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

  -- 5. No heartbeat for a while: shown as Offline. (M4: Realtime notice.)
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

  return jsonb_build_object('warned', v_warned, 'final_prompt', v_final, 'expired', v_expired,
                            'left_venue', v_away, 'offline', v_offline);
end;
$$;
revoke all on function public.tick() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- hourly_cleanup(): the parts that exist so far (§8)
-- -----------------------------------------------------------------------------
create function public.hourly_cleanup()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rate integer;
  v_sms  integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;
  delete from public.sms_log where created_at < now() - interval '30 days';
  get diagnostics v_sms = row_count;
  return jsonb_build_object('rate_limits', v_rate, 'sms_log', v_sms);
end;
$$;
revoke all on function public.hourly_cleanup() from public, anon, authenticated;
