-- =============================================================================
-- Migration sessions: starting a session, heartbeat and location, away and
-- offline, the timer (warning → final prompt → end), continue, logout, and the
-- tick. Time cannot pass inside one transaction (now() is fixed), so tests move
-- the session's own timestamps into the past instead. Rolled back at the end.
-- =============================================================================
begin;
-- See rls_test.sql for why tests switch role and set the search path.
set local role postgres;
create extension if not exists pgtap with schema extensions;
do $$
begin
  perform set_config(
    'search_path',
    (select quote_ident(n.nspname)
     from pg_extension e
     join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pgtap') || ', public',
    true
  );
end
$$;
select plan(55);

-- The timings these tests expect, whatever dev is set to (e.g. 3-minute
-- sessions for a phone test). Rolled back with everything else.
update public.app_settings set value = '60' where key = 'FREE_SESSION_MINUTES';
update public.app_settings set value = '15' where key = 'WARNING_BEFORE_MINUTES';
update public.app_settings set value = '120' where key = 'FINAL_PROMPT_SECONDS';
update public.app_settings set value = '180' where key = 'AWAY_GRACE_SECONDS';
update public.app_settings set value = '90' where key = 'OFFLINE_AFTER_SECONDS';

-- Two venues ~1.3 km apart, each with one table.
insert into public.venues (id, slug, name, type, latitude, longitude, is_active) values
  ('20000000-0000-4000-8000-000000000001', 'cafe-one', 'Cafe One', 'cafe', 23.022500, 72.571400, true),
  ('20000000-0000-4000-8000-000000000002', 'cafe-two', 'Cafe Two', 'cafe', 23.030000, 72.580000, true);
insert into public.tables (id, venue_id, label, qr_token) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'T1', 'SessTestToken001'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'T1', 'SessTestToken002');

-- Guests: d1 finished onboarding, d2 consented but stopped there, d3 is under age.
insert into auth.users (id, phone) values
  ('00000000-0000-4000-8000-0000000000d1', '919000000031'),
  ('00000000-0000-4000-8000-0000000000d2', '919000000032'),
  ('00000000-0000-4000-8000-0000000000d3', '919000000033');
update public.profiles
set consent_at = now(), consent_version = public.setting('CONSENT_VERSION') #>> '{}', birth_year = 1995
where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d3');
update public.profiles set age_blocked = true where id = '00000000-0000-4000-8000-0000000000d3';
update public.profiles set consent_at = now(), consent_version = public.setting('CONSENT_VERSION') #>> '{}'
where id = '00000000-0000-4000-8000-0000000000d2';
insert into public.tags (name) values ('music') on conflict (name) do nothing;
insert into public.user_tags (user_id, tag_id)
select p, t.id from public.tags t,
  unnest(array['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d3']::uuid[]) p
where t.name = 'music';

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

create function pg_temp.start(p_slug text, p_token text, p_lat double precision, p_lng double precision,
                              p_acc double precision default 10)
returns public.session_state language plpgsql as $$
begin
  -- now() is the same for the whole test; push earlier sessions back a minute
  -- so 'the latest session' stays well defined.
  update public.sessions set started_at = started_at - interval '1 minute'
  where user_id = '00000000-0000-4000-8000-0000000000d1';
  return public.start_session(p_slug, p_token, p_lat, p_lng, p_acc, 5, 'test-device-0001');
end $$;

-- A heartbeat whose reading is always newer than the last one evaluated: the
-- helper first moves the session's last evaluated reading an hour back.
create function pg_temp.beat(p_lat double precision, p_lng double precision,
                             p_acc double precision default 10, p_permission text default 'granted')
returns public.session_state language plpgsql as $$
begin
  update public.sessions set location_checked_at = now() - interval '1 hour', last_taken_at = now() - interval '1 hour'
  where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
  return public.heartbeat(p_lat, p_lng, p_acc, 1, p_permission);
end $$;

create function pg_temp.live() returns public.sessions language sql as $$
  select * from public.sessions where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
$$;

create function pg_temp.latest() returns public.sessions language sql as $$
  select * from public.sessions where user_id = '00000000-0000-4000-8000-0000000000d1'
  order by started_at desc limit 1;
$$;

-- Who may start ----------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d2'); end $$;
select throws_ok($$select pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714)$$,
  'P0001', 'PROFILE_INCOMPLETE', 'a guest who has not finished onboarding cannot start');
select is((select count(*)::integer from public.my_session()), 0, 'a guest with no sessions has nothing to show');
select throws_ok($$select public.heartbeat()$$, 'P0001', 'SESSION_NOT_ACTIVE',
  'a heartbeat without any session is refused');

do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d3'); end $$;
select throws_ok($$select pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714)$$,
  'P0001', 'AGE_BLOCKED', 'an under-age guest cannot start');

do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000d1'); end $$;
select throws_ok($$select pg_temp.start('cafe-one', 'SessTestToken001', 23.0325, 72.5714)$$,
  'P0001', 'NOT_AT_VENUE', 'starting from 1 km away is refused');
select throws_ok($$select pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714, 200)$$,
  'P0001', 'LOCATION_INACCURATE', 'a reading too imprecise to decide is refused');
select throws_ok($$select public.start_session('cafe-one', 'SessTestToken001', 23.0225, 72.5714, 10, 1, 'x')$$,
  'P0001', 'DEVICE_ID_INVALID', 'a malformed device id is refused');

insert into public.bans (scope, user_id, reason) values ('platform', '00000000-0000-4000-8000-0000000000d1', 'test');
select throws_ok($$select pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714)$$,
  'P0001', 'BANNED', 'a banned guest cannot start');
delete from public.bans where user_id = '00000000-0000-4000-8000-0000000000d1';

-- Starting ------------------------------------------------------------------------------
create temporary table first_session on commit drop as
  select * from pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714);
select is((select status from first_session), 'active', 'an inside guest starts an active session');
select is((select kind from first_session), 'free', 'with payments off the session is free');
select is((select expires_at - started_at from first_session), interval '60 minutes',
  'it lasts FREE_SESSION_MINUTES');
select is((select warning_at from first_session), (select expires_at - interval '15 minutes' from first_session),
  'the warning time is WARNING_BEFORE_MINUTES before the end');
select is((select venue_name || ' ' || table_label from first_session), 'Cafe One T1',
  'the state names the venue and the table');
select is((pg_temp.start('cafe-one', 'SessTestToken001', 23.0225, 72.5714)).session_id,
  (select session_id from first_session), 'scanning again at the same venue returns the same session');
select is((select count(*)::integer from public.sessions where user_id = '00000000-0000-4000-8000-0000000000d1'),
  1, 'there is still only one session');

insert into public.bans (scope, venue_id, user_id, reason, expires_at)
values ('venue', '20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000d1', 'test', now() + interval '12 hours');
select throws_ok($$select pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800)$$,
  'P0001', 'KICKED_COOLDOWN', 'a guest kicked from a venue cannot re-enter it during the cooldown');
delete from public.bans where user_id = '00000000-0000-4000-8000-0000000000d1';

insert into public.venue_settings (venue_id, key, value)
values ('20000000-0000-4000-8000-000000000002', 'PAYMENTS_ENABLED', 'true');
select throws_ok($$select pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800)$$,
  'P0001', 'PAYMENT_REQUIRED', 'with the scan fee on, a start is refused until payments exist (M5)');
select is((pg_temp.live()).id, (select session_id from first_session),
  'the refused start left the current session untouched');
delete from public.venue_settings where venue_id = '20000000-0000-4000-8000-000000000002';

create temporary table second_session on commit drop as
  select * from pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800);
select is((select end_reason from public.sessions where id = (select session_id from first_session)),
  'left_venue', 'starting at another venue ends the session at the first one');
select is((pg_temp.live()).venue_id, '20000000-0000-4000-8000-000000000002'::uuid,
  'the live session is now at the second venue');

-- Heartbeat, away and offline (at cafe-two from here) -----------------------------
select is((pg_temp.beat(23.0300, 72.5800)).away_since, null, 'inside: not away');
select isnt((pg_temp.beat(23.0400, 72.5800)).away_since, null, 'an outside reading starts the away time');
select is((pg_temp.beat(23.0300, 72.5800)).away_since, null, 'coming back inside clears it');
select is((public.heartbeat(23.0400, 72.5800, 10, 7200)).away_since, null,
  'a reading older than the last one evaluated changes nothing');
select isnt((pg_temp.beat(null, null, null, 'denied')).away_since, null,
  'location permission turned off counts as outside');

update public.sessions set away_since = now() - interval '181 seconds'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select ok((public.tick() ->> 'left_venue')::integer >= 1, 'the tick ends a session away longer than AWAY_GRACE_SECONDS');
select is((pg_temp.latest()).end_reason, 'left_venue', 'with reason left_venue');
select is((pg_temp.latest()).last_lat, null, 'the raw position is wiped when the session ends');
select is((public.heartbeat()).status, 'ended', 'a heartbeat after the end answers with the ended state');

-- New session for the presence tests.
select lives_ok($$select pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800)$$,
  'the guest can start again after leaving');
update public.sessions set last_seen_at = now() - interval '100 seconds'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select ok((public.tick() ->> 'offline')::integer >= 1, 'the tick marks a silent phone offline');
select is((pg_temp.live()).status, 'active', 'offline is a flag: the session stays live (locked phone)');
select is((pg_temp.beat(23.0300, 72.5800)).status, 'active', 'back from offline while inside: still live');
select is((pg_temp.live()).is_offline, false, 'and no longer offline');

update public.sessions set last_seen_at = now() - interval '100 seconds'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select is((pg_temp.beat(23.0400, 72.5800)).end_reason, 'left_venue',
  'back from offline and outside (app reopened at home): ended at once');

-- Timer ------------------------------------------------------------------------------
select lives_ok($$select pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800)$$, 'new session for the timer tests');
select throws_ok($$select public.continue_free()$$, 'P0001', 'CONTINUE_NOT_AVAILABLE',
  'continue is not offered before the warning');

update public.sessions set expires_at = now() + interval '10 minutes'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select ok((public.tick() ->> 'warned')::integer >= 1, 'the tick sends the warning WARNING_BEFORE_MINUTES before the end');
select isnt((pg_temp.live()).warning_sent_at, null, 'and records it, so it is sent once');

update public.sessions set expires_at = now() - interval '1 second'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select ok((public.tick() ->> 'final_prompt')::integer >= 1, 'at the end the tick starts the final prompt');
select is((pg_temp.live()).final_deadline_at, now() + interval '120 seconds',
  'the final prompt lasts FINAL_PROMPT_SECONDS');

select is((public.continue_free()).status, 'active', 'continue free from the final prompt makes it active again');
select is((pg_temp.live()).expires_at, now() + interval '60 minutes', 'with a new block of FREE_SESSION_MINUTES from now');
select is((pg_temp.live()).warning_sent_at, null, 'and a fresh warning to come');

update public.sessions set status = 'final_prompt', final_deadline_at = now() - interval '1 second'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select ok((public.tick() ->> 'expired')::integer >= 1, 'nothing chosen in the final prompt: the tick ends it');
select is((select end_reason from public.my_session()), 'expired',
  'reopening the app shows that the session expired');

-- Logout, payments switch, spoof signals --------------------------------------------
select lives_ok($$select pg_temp.start('cafe-two', 'SessTestToken002', 23.0300, 72.5800)$$, 'new session');
insert into public.venue_settings (venue_id, key, value)
values ('20000000-0000-4000-8000-000000000002', 'PAYMENTS_ENABLED', 'true');
update public.sessions set expires_at = now() - interval '1 second'
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select throws_ok($$select public.continue_free()$$, 'P0001', 'FEATURE_DISABLED',
  'continue free is not available while payments are on');
delete from public.venue_settings where venue_id = '20000000-0000-4000-8000-000000000002';

select is((pg_temp.beat(23.0300, 72.5800, 0)).status, 'active', 'a spoof signal never ends a session by itself');
select ok((pg_temp.live()).spoof_flags @> '[{"type": "zero_accuracy"}]', 'a 0 m accuracy is flagged for review');
update public.sessions set last_taken_at = now() - interval '10 seconds', location_checked_at = now() - interval '10 seconds',
  last_lat = 23.030000, last_lng = 72.580000
where user_id = '00000000-0000-4000-8000-0000000000d1' and status <> 'ended';
select lives_ok($$select public.heartbeat(23.1300, 72.5800, 10, 1)$$, 'a heartbeat 11 km away, 9 s after the last reading');
select ok((pg_temp.live()).spoof_flags @> '[{"type": "speed"}]', 'is flagged as an impossible speed');

select is((public.end_my_session()).end_reason, 'user_logout', 'log out ends the session');
select is((public.end_my_session()).end_reason, 'user_logout', 'logging out again just returns the ended state');

-- Housekeeping -------------------------------------------------------------------------
insert into public.rate_limits (key, window_start, count) values ('old:test', now() - interval '2 days', 1);
select ok((public.hourly_cleanup() ->> 'rate_limits')::integer >= 1, 'the hourly clean-up drops old rate-limit windows');

select * from finish();
rollback;
