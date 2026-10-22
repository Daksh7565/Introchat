-- =============================================================================
-- Migration console_ops: live guests and kicks, close for today and reopen,
-- location flags, stats, audit log, SMS usage, admins, account deletion.
-- Rolled back at the end.
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
select plan(49);

update public.app_settings set value = v.value from (values
  ('PAYMENTS_ENABLED', 'false'::jsonb), ('KICK_COOLDOWN_HOURS', '12')) v(key, value)
where app_settings.key = v.key;

insert into public.venues (id, slug, name, type, latitude, longitude, is_active)
values ('80000000-0000-4000-8000-000000000001', 'ops-cafe', 'Ops Cafe', 'cafe', 23.022500, 72.571400, true);
insert into public.tables (id, venue_id, label, qr_token)
values ('81000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'T1', 'OpsTestToken0001');

-- Guests g1..g3 (complete), live at the venue; g2 paid for their visit.
insert into auth.users (id, phone)
select ('00000000-0000-4000-8000-00000000008' || n)::uuid, '91900000008' || n from generate_series(1, 3) n;
update public.profiles set consent_at = now(), consent_version = public.setting('CONSENT_VERSION') #>> '{}',
  birth_year = 1995, gender = case id when '00000000-0000-4000-8000-000000000081' then 'female' else null end
where id::text like '00000000-0000-4000-8000-00000000008_';
insert into public.tags (name) values ('music') on conflict (name) do nothing;
insert into public.user_tags (user_id, tag_id)
select p.id, t.id from public.profiles p, public.tags t
where p.id::text like '00000000-0000-4000-8000-00000000008_' and t.name = 'music';
insert into public.sessions (id, user_id, venue_id, table_id, kind, expires_at, location_state, device_id, spoof_flags) values
  ('82000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000081', '80000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000001', 'free', now() + interval '1 hour', 'inside', 'ops-device-1', '[{"type": "speed"}]'),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000082', '80000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000001', 'paid_scan', now() + interval '1 hour', 'inside', 'ops-device-2', '[]'),
  ('82000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000083', '80000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000001', 'free', now() + interval '1 hour', 'inside', 'ops-device-3', '[]');
insert into public.payments (id, user_id, venue_id, session_id, purpose, amount_paise, status, paid_at)
values ('83000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000082', '80000000-0000-4000-8000-000000000001',
        '82000000-0000-4000-8000-000000000002', 'scan_fee', 1900, 'paid', now());

-- Two admins (a1 signs in with 2-step; a2 is the one deactivated) and an email login not yet an admin.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'ops1@test.introchat'),
  ('00000000-0000-4000-8000-0000000000c2', 'ops2@test.introchat'),
  ('00000000-0000-4000-8000-0000000000c3', 'newadmin@test.introchat');
insert into public.admins (user_id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'ops1@test.introchat'),
  ('00000000-0000-4000-8000-0000000000c2', 'ops2@test.introchat');

create function pg_temp.act_as(p_user text, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || p_user), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Live guests and kicks ------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('81', 'aal1'); end $$;
select throws_ok($$select * from public.admin_live_guests('80000000-0000-4000-8000-000000000001')$$, 'P0001', 'FORBIDDEN',
  'guests cannot see the live list');
do $$ begin perform pg_temp.act_as('c1'); end $$;
select is((select count(*)::integer from public.admin_live_guests('80000000-0000-4000-8000-000000000001')), 3,
  'an admin sees everyone in the venue now');
select is((select spoof_flags from public.admin_live_guests('80000000-0000-4000-8000-000000000001')
           where session_id = '82000000-0000-4000-8000-000000000001'), 1, 'with their location flags counted');
select throws_ok($$select public.admin_kick('82000000-0000-4000-8000-000000000003', ' ')$$, 'P0001', 'VALIDATION_FAILED',
  'a kick needs a note');
select lives_ok($$select public.admin_kick('82000000-0000-4000-8000-000000000003', 'Rude to staff')$$, 'an admin kicks g3');
select is((select end_reason from public.sessions where id = '82000000-0000-4000-8000-000000000003'), 'kicked', 'g3''s visit ends');
select ok(exists (select 1 from public.bans where user_id = '00000000-0000-4000-8000-000000000083' and scope = 'venue'
                  and venue_id = '80000000-0000-4000-8000-000000000001' and device_id = 'ops-device-3'),
  'and g3 is kept out of the venue (account, phone and device)');
select throws_ok($$select public.admin_kick('82000000-0000-4000-8000-000000000003', 'again')$$, 'P0001', 'SESSION_NOT_ACTIVE',
  'an ended visit cannot be kicked again');

-- Location flags ------------------------------------------------------------------------
select ok(exists (select 1 from public.admin_list_spoof_flags(7) where session_id = '82000000-0000-4000-8000-000000000001'),
  'flagged visits are listed for review');

-- Close for today ------------------------------------------------------------------------
create temporary table closed on commit drop as
  select * from public.admin_close_venue_today('80000000-0000-4000-8000-000000000001', 'Private event tonight');
select is((select count(*)::integer from closed), 1, 'closing lists the paid visit it cut short');
select is((select payment_id from closed), '83000000-0000-4000-8000-000000000001'::uuid, 'with its payment, for a refund');
select is((select count(*)::integer from public.sessions
           where venue_id = '80000000-0000-4000-8000-000000000001' and status <> 'ended'), 0, 'every visit ends');
select is((select end_reason from public.sessions where id = '82000000-0000-4000-8000-000000000001'), 'venue_closed',
  'with reason venue_closed');
select is((select closed_until from public.venues where id = '80000000-0000-4000-8000-000000000001'),
  ((pg_temp.today() + 1)::timestamp at time zone 'Asia/Kolkata'), 'scans are refused until local midnight');
do $$ begin perform pg_temp.act_as('81', 'aal1'); end $$;
select throws_ok($$select public.start_session('ops-cafe', 'OpsTestToken0001', 23.0225, 72.5714, 10, 1, 'ops-device-1')$$,
  'P0001', 'VENUE_CLOSED', 'nobody can enter while closed');
do $$ begin perform pg_temp.act_as('c1'); end $$;
select lives_ok($$select public.admin_reopen_venue('80000000-0000-4000-8000-000000000001', 'Event cancelled')$$, 'an admin reopens early');
select is((select closed_until from public.venues where id = '80000000-0000-4000-8000-000000000001'), null, 'open again');
select throws_ok($$select public.admin_reopen_venue('80000000-0000-4000-8000-000000000001', 'again')$$, 'P0001', 'VENUE_NOT_CLOSED',
  'reopening an open venue is refused');

-- Stats ------------------------------------------------------------------------------------
create temporary table stats on commit drop as
  select * from public.admin_stats(pg_temp.today(), pg_temp.today(), '80000000-0000-4000-8000-000000000001');
select is((select visits from stats), 3, 'stats count today''s visits');
select is((select unique_guests from stats), 3, 'and unique guests');
select is((select revenue_paise from stats), 1900::bigint, 'and revenue in paise');
select is((select guests_female from stats), 1, 'gender only as counts');
select is((select guests_undisclosed from stats), 2, 'not given counts as undisclosed');
select throws_ok(format($$select * from public.admin_stats(%L, %L)$$, pg_temp.today(), pg_temp.today() - 1),
  'P0001', 'VALIDATION_FAILED', 'a backwards date range is refused');

-- Audit log and SMS usage -----------------------------------------------------------------
-- Scoped to this test's venue: dev also holds real admins' actions.
select is((select count(*)::integer from public.admin_list_audit('venue.', '80000000-0000-4000-8000-000000000001')), 2,
  'the audit log filters by action and venue (close, reopen)');
select is((select actor from public.admin_list_audit('guest.kick')), 'ops1@test.introchat', 'and names the admin');
insert into public.sms_log (phone_hash, status, reason, finished_at) values
  ('h1', 'sent', null, now()), ('h2', 'sent', null, now()), ('h3', 'refused', 'RATE_LIMITED', now());
select is((select sum(attempts)::integer from public.admin_sms_usage(1) where day = pg_temp.today() and status = 'sent'), 2,
  'SMS usage counts today''s sent codes (by India date)');
select is((select attempts from public.admin_sms_usage(1) where status = 'refused' and reason = 'RATE_LIMITED'), 1,
  'and refusals by reason');

-- Admins ------------------------------------------------------------------------------------
select is((select count(*)::integer from public.admin_list_admins() where email like '%@test.introchat'), 2,
  'admins are listed (counting this test''s; dev has real ones too)');
select throws_ok($$select public.admin_add_admin('nobody@test.introchat')$$, 'P0001', 'ADMIN_LOGIN_NOT_FOUND',
  'only an existing email login can be made an admin');
select isnt(public.admin_add_admin('  NewAdmin@test.introchat '), null, 'an existing login becomes an admin');
select throws_ok($$select public.admin_add_admin('newadmin@test.introchat')$$, 'P0001', 'ADMIN_EXISTS', 'once');
select throws_ok($$select public.admin_set_admin_active('00000000-0000-4000-8000-0000000000c1', false)$$, 'P0001', 'ADMIN_SELF',
  'an admin cannot deactivate themselves');
select lives_ok($$select public.admin_set_admin_active('00000000-0000-4000-8000-0000000000c2', false)$$, 'an admin deactivates another');
do $$ begin perform pg_temp.act_as('c2'); end $$;
select throws_ok($$select * from public.admin_list_admins()$$, 'P0001', 'FORBIDDEN', 'a deactivated admin is refused at once');

-- Account deletion --------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('82', 'aal1'); end $$;
create temporary table asked on commit drop as select public.request_account_deletion() as at;
select is(public.request_account_deletion(), (select at from asked), 'asking twice keeps the one request');
select is(public.my_deletion_request(), (select at from asked), 'the guest sees their pending request');
select lives_ok($$select public.cancel_account_deletion()$$, 'the guest can cancel it');
select throws_ok($$select public.cancel_account_deletion()$$, 'P0001', 'DELETION_NOT_REQUESTED', 'once');
select lives_ok($$select public.request_account_deletion()$$, 'and ask again');

-- g2 is reported and banned before deleting: the ban must survive the deletion.
insert into public.reports (reporter_id, reported_id, reported_phone_hash, reported_handle, venue_id, reason)
select '00000000-0000-4000-8000-000000000081', p.id, p.phone_hash, p.handle, '80000000-0000-4000-8000-000000000001', 'spam'
from public.profiles p where p.id = '00000000-0000-4000-8000-000000000082';
insert into public.bans (scope, user_id, phone_hash, reason)
select 'platform', p.id, p.phone_hash, 'test' from public.profiles p where p.id = '00000000-0000-4000-8000-000000000082';

do $$ begin perform pg_temp.act_as('c1'); end $$;
select is((select open_reports from public.admin_list_deletion_requests()
           where handle = (select handle from public.profiles where id = '00000000-0000-4000-8000-000000000082')), 1,
  'the admin sees the guest has an open report before deleting');
select lives_ok(format($$select public.admin_process_deletion(%L, 'Requested by the guest')$$,
  (select request_id from public.admin_list_deletion_requests()
   where handle = (select handle from public.profiles where id = '00000000-0000-4000-8000-000000000082'))),
  'an admin deletes the account');
select is((select count(*)::integer from auth.users where id = '00000000-0000-4000-8000-000000000082'), 0, 'the login is gone');
select is((select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-000000000082'), 0,
  'with the profile and everything personal');
select is((select user_id from public.payments where id = '83000000-0000-4000-8000-000000000001'), null,
  'the payment record stays, without the person');
select is((select count(*)::integer from public.reports where reported_handle is not null
           and reported_phone_hash = public.phone_hash('919000000082')), 1, 'the report about them stays');
select is((select refusal from public.sms_hook_check('919000000082')), 'BANNED',
  'and the ban still stops that phone from getting a login code');
select is((select status from public.account_deletion_requests where processed_by = '00000000-0000-4000-8000-0000000000c1'),
  'completed', 'the request is recorded as done');
select throws_ok(format($$select public.admin_process_deletion(%L, 'again')$$,
  (select id from public.account_deletion_requests where processed_by = '00000000-0000-4000-8000-0000000000c1')),
  'P0001', 'DELETION_NOT_PENDING', 'a request is processed once');

select * from finish();
rollback;
