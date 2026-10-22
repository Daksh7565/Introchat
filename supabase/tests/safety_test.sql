-- =============================================================================
-- Migration safety: block, report with evidence (also after the other person
-- left), kick, platform ban and lift, blocked tags and words, evidence
-- expiry, and who may do what. Rolled back at the end.
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
select plan(52);

update public.app_settings set value = v.value from (values
  ('PAYMENTS_ENABLED', 'false'::jsonb), ('KICK_COOLDOWN_HOURS', '12'), ('REPORT_EVIDENCE_ENABLED', 'true'),
  ('REPORT_EVIDENCE_MESSAGES', '50'), ('REPORT_EVIDENCE_RETENTION_DAYS', '30')) v(key, value)
where app_settings.key = v.key;

insert into public.venues (id, slug, name, type, latitude, longitude, is_active)
values ('70000000-0000-4000-8000-000000000001', 'safe-cafe', 'Safe Cafe', 'cafe', 23.022500, 72.571400, true);
insert into public.tables (venue_id, label, qr_token)
values ('70000000-0000-4000-8000-000000000001', 'T1', 'SafeTestToken001');

-- k1..k4 onboarded guests; k1, k2, k3, k4 in the venue.
insert into auth.users (id, phone)
select ('00000000-0000-4000-8000-00000000007' || n)::uuid, '91900000007' || n from generate_series(1, 4) n;
update public.profiles set consent_at = now(), consent_version = public.setting('CONSENT_VERSION') #>> '{}', birth_year = 1995
where id::text like '00000000-0000-4000-8000-00000000007_';
insert into public.tags (name) values ('music'), ('chess') on conflict (name) do nothing;
insert into public.user_tags (user_id, tag_id)
select p.id, t.id from public.profiles p, public.tags t
where p.id::text like '00000000-0000-4000-8000-00000000007_' and t.name in ('music', 'chess');
insert into public.sessions (id, user_id, venue_id, kind, expires_at, location_state, device_id)
select ('71000000-0000-4000-8000-00000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000007' || n)::uuid,
       '70000000-0000-4000-8000-000000000001', 'free', now() + interval '1 hour', 'inside', 'safety-device-' || n
from generate_series(1, 4) n;

-- k1 and k2 have been chatting.
insert into public.conversations (id, user_low_id, user_high_id)
values ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000072');
insert into public.conversation_members (conversation_id, user_id) values
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000071'),
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000072');
insert into public.messages (conversation_id, sender_user_id, client_msg_id, body) values
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000071', gen_random_uuid(), 'Hi there'),
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000072', gen_random_uuid(), 'something abusive');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ab', 'safeadmin@test.introchat');
insert into public.admins (user_id, email) values ('00000000-0000-4000-8000-0000000000ab', 'safeadmin@test.introchat');

create function pg_temp.k(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-00000000007' || n)::uuid;
$$;
create function pg_temp.sess(n int) returns uuid language sql as $$
  select ('71000000-0000-4000-8000-00000000000' || n)::uuid;
$$;
create function pg_temp.act_as(p_user uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab', 'aal2');
$$;
create function pg_temp.sees(p_viewer int, p_target int) returns boolean language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.k(p_viewer));
  return exists (select 1 from public.get_people() p where p.session_id = pg_temp.sess(p_target));
end $$;

-- Block ----------------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.k(3)); end $$;
select throws_ok($$select public.block_person(pg_temp.sess(1), '72000000-0000-4000-8000-000000000001')$$,
  'P0001', 'VALIDATION_FAILED', 'a block names exactly one target');
select throws_ok($$select public.block_person(pg_temp.sess(3))$$, 'P0001', 'TARGET_NOT_AVAILABLE',
  'nobody blocks themselves');
select lives_ok($$select public.block_person(pg_temp.sess(1))$$, 'k3 blocks k1 from the people list');
select ok(not pg_temp.sees(3, 1), 'the blocker no longer sees them');
select ok(not pg_temp.sees(1, 3), 'and they no longer see the blocker: invisible both ways');
select ok(pg_temp.sees(1, 2), 'everyone else is still visible');
do $$ begin perform pg_temp.act_as(pg_temp.k(1)); end $$;
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(3))$$, 'P0001', 'BLOCKED',
  'a blocked pair cannot send requests');
select ok(exists (select 1 from realtime.messages where topic = 'user:' || pg_temp.k(1) and event = 'person.removed'),
  'the blocked guest''s screen is told to refresh');

-- Report, after the other person left -----------------------------------------------------
select lives_ok($$select public.end_session(pg_temp.sess(2), 'user_logout')$$, 'k2 leaves; k1''s chat is read-only');
do $$ begin perform pg_temp.act_as(pg_temp.k(1)); end $$;
select throws_ok($$select public.report_person('rude', null, null, '72000000-0000-4000-8000-000000000001')$$,
  'P0001', 'VALIDATION_FAILED', 'a report needs a known reason');
select throws_ok(format($$select public.report_person('harassment', %L, null, '72000000-0000-4000-8000-000000000001')$$, repeat('x', 501)),
  'P0001', 'VALIDATION_FAILED', 'a note is at most 500 characters');
create temporary table rep1 on commit drop as
  select public.report_person('harassment', '  Sent abuse  ', null, '72000000-0000-4000-8000-000000000001') as id;
select isnt((select id from rep1), null, 'k1 reports k2 from the read-only chat');
select is((select jsonb_array_length(evidence -> 'messages') from public.reports where id = (select id from rep1)), 2,
  'the evidence holds the chat, though k2 has left');
select is((select evidence -> 'messages' -> 1 ->> 'from' from public.reports where id = (select id from rep1)), 'reported',
  'each message says who wrote it');
select is((select evidence ->> 'handle' from public.reports where id = (select id from rep1)),
  (select handle from public.profiles where id = pg_temp.k(2)), 'and the reported handle');
select is((select note from public.reports where id = (select id from rep1)), 'Sent abuse', 'the note is trimmed');
select is((select count(*)::integer from public.conversations where id = '72000000-0000-4000-8000-000000000001'), 0,
  'reporting also blocks: the conversation is gone for both');
select ok(exists (select 1 from public.blocks where blocker_id = pg_temp.k(1) and blocked_id = pg_temp.k(2)),
  'and the block is recorded');
select ok(exists (select 1 from realtime.messages where topic = 'admin' and event = 'report.new'),
  'admins are told about the new report');

-- Reporting someone never chatted with: their handle and interests are the evidence.
create temporary table rep4 on commit drop as select public.report_person('inappropriate', null, pg_temp.sess(4)) as id;
select is((select evidence -> 'messages' from public.reports where id = (select id from rep4)), 'null'::jsonb,
  'a report without a chat has no messages');
select is((select jsonb_array_length(evidence -> 'tags') from public.reports where id = (select id from rep4)), 2,
  'but records the interests they showed');

-- Admin: reports and kicks ---------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.k(1)); end $$;
select throws_ok($$select * from public.admin_list_reports()$$, 'P0001', 'FORBIDDEN', 'guests cannot read reports');
do $$ begin perform pg_temp.admin(); end $$;
select ok((select count(*) from public.admin_list_reports() where report_id in ((select id from rep1), (select id from rep4))) = 2,
  'admins see open reports');
select isnt(public.admin_report_evidence((select id from rep1)), null, 'and their evidence');
select throws_ok(format($$select public.admin_resolve_report(%L, 'kick', '')$$, (select id from rep1)),
  'P0001', 'VALIDATION_FAILED', 'every decision needs a note');
select lives_ok(format($$select public.admin_resolve_report(%L, 'kick', 'Abusive messages')$$, (select id from rep1)),
  'an admin kicks k2 out of the venue, though they already left');
select is((select expires_at from public.bans where reason = 'report:' || (select id from rep1)), now() + interval '12 hours',
  'for KICK_COOLDOWN_HOURS');
select is((select status || '/' || action from public.reports where id = (select id from rep1)), 'actioned/kick',
  'the report is closed as actioned');
select throws_ok(format($$select public.admin_resolve_report(%L, 'dismiss', 'again')$$, (select id from rep1)),
  'P0001', 'REPORT_ALREADY_RESOLVED', 'a report is resolved once');
do $$ begin perform pg_temp.act_as(pg_temp.k(2)); end $$;
select throws_ok($$select public.start_session('safe-cafe', 'SafeTestToken001', 23.0225, 72.5714, 10, 1, 'safety-device-2')$$,
  'P0001', 'KICKED_COOLDOWN', 'a kicked guest cannot rejoin that venue during the cooldown');

-- Admin: bans ----------------------------------------------------------------------------
do $$ begin perform pg_temp.admin(); end $$;
select lives_ok(format($$select public.admin_resolve_report(%L, 'ban', 'Repeated', 7)$$, (select id from rep4)),
  'an admin bans k4 for 7 days from a report');
select is((select end_reason from public.sessions where id = pg_temp.sess(4)), 'banned', 'k4''s visit ends at once');
select is((select expires_at from public.bans where reason = 'report:' || (select id from rep4)), now() + interval '7 days',
  'for 7 days');
select is((select device_id from public.bans where reason = 'report:' || (select id from rep4)), 'safety-device-4',
  'matched by their device too');
do $$ begin perform pg_temp.act_as(pg_temp.k(4)); end $$;
select throws_ok($$select * from public.my_profile()$$, 'P0001', 'BANNED', 'a banned guest is refused on every call');
select throws_ok($$select * from public.get_people()$$, 'P0001', 'BANNED', 'including chat');
select is((select refusal from public.sms_hook_check('919000000074')), 'BANNED', 'and gets no login code');

do $$ begin perform pg_temp.admin(); end $$;
select lives_ok(format($$select public.admin_lift_ban((select id from public.bans where reason = %L), 'Appeal accepted')$$,
  'report:' || (select id from rep4)), 'an admin lifts the ban');
select throws_ok(format($$select public.admin_lift_ban((select id from public.bans where reason = %L), 'again')$$,
  'report:' || (select id from rep4)), 'P0001', 'BAN_NOT_FOUND', 'a ban is lifted once');
do $$ begin perform pg_temp.act_as(pg_temp.k(4)); end $$;
select lives_ok($$select * from public.my_profile()$$, 'after the lift the guest is let in again');

do $$ begin perform pg_temp.admin(); end $$;
select lives_ok($$select public.admin_ban_guest(pg_temp.k(3), 'Spam account')$$, 'an admin bans k3 permanently (no days given)');
select is((select expires_at from public.admin_list_bans() where guest_handle = (select handle from public.profiles where id = pg_temp.k(3))),
  null, 'the active bans list shows it, with no end');

-- Reports survive account deletion -------------------------------------------------------
delete from auth.users where id = pg_temp.k(2);
select is((select reported_id from public.reports where id = (select id from rep1)), null,
  'a report outlives the reported account');
select is((select reported_phone_hash from public.reports where id = (select id from rep1)), public.phone_hash('919000000072'),
  'keeping the phone hash, so a ban can still land');

-- Blocked tags and words -----------------------------------------------------------------
do $$ begin perform pg_temp.admin(); end $$;
select lives_ok($$select public.admin_set_tag_blocked('chess', true)$$, 'an admin blocks a tag');
do $$ begin perform pg_temp.act_as(pg_temp.k(1)); end $$;
select ok(not exists (select 1 from public.tag_suggestions('ches')), 'a blocked tag is no longer suggested');
select throws_ok($$select public.set_tags(array['chess'])$$, 'P0001', 'TAG_NOT_ALLOWED', 'or chosen');
do $$ begin perform pg_temp.admin(); end $$;
select is(public.admin_add_blocked_term('  Badword '), 'badword', 'an admin adds a blocked word (normalised)');
do $$ begin perform pg_temp.act_as(pg_temp.k(1)); end $$;
select throws_ok($$select public.set_tags(array['badword fan'])$$, 'P0001', 'TAG_NOT_ALLOWED',
  'a new tag containing it is refused');
do $$ begin perform pg_temp.admin(); end $$;
select lives_ok($$select public.admin_remove_blocked_term('badword')$$, 'and removes it');

-- Evidence expiry, channels ------------------------------------------------------------------
update public.reports set evidence_expires_at = now() - interval '1 second' where id = (select id from rep4);
select ok((public.hourly_cleanup() ->> 'evidence_erased')::integer >= 1
          , 'the hourly clean-up erases evidence past its retention');
do $$ begin perform pg_temp.admin(); end $$;
select ok(public.realtime_topic_allowed('admin', false), 'admins listen on the admin channel');

select * from finish();
rollback;
