-- =============================================================================
-- Migration 0001: settings, admins / is_admin(), audit log, rate limits.
-- Everything runs inside a transaction that is rolled back: nothing is left
-- behind on the project the tests run against.
-- =============================================================================
begin;
-- `supabase test db --linked` connects as a temporary role (cli_login_postgres)
-- that has no USAGE on schema `extensions`, where pgtap lives, so plan() is
-- invisible to it. That role is a member of postgres, the owner of everything
-- the migrations create; tests run as postgres for this transaction only.
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- Put whichever schema pgtap lives in on the path, for this transaction only.
-- (A DO block, so nothing is printed into the TAP output.)
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
select plan(20);

-- app_settings -----------------------------------------------------------------
-- The 36 settings seeded by 0001 are all present (later migrations add more,
-- so this checks presence, not the total).
select is(
  (select count(*)::integer from public.app_settings where key in (
    'PAYMENTS_ENABLED', 'SCAN_FEE_ENABLED', 'SUBSCRIPTION_ENABLED', 'SCAN_FEE_PAISE',
    'SCAN_SESSION_MINUTES', 'CONTINUE_FEE_PAISE', 'CONTINUE_MINUTES', 'SUBSCRIPTION_PRICE_PAISE',
    'SUBSCRIPTION_SCANS', 'SUBSCRIPTION_SESSION_MINUTES', 'FREE_SESSION_MINUTES',
    'WARNING_BEFORE_MINUTES', 'FINAL_PROMPT_SECONDS', 'PAYMENT_GRACE_SECONDS',
    'UNUSED_FEE_VALID_MINUTES', 'HEARTBEAT_INTERVAL_SECONDS', 'LOCATION_INTERVAL_SECONDS',
    'OFFLINE_AFTER_SECONDS', 'AWAY_GRACE_SECONDS', 'GEOFENCE_RADIUS_M', 'MAX_ACCURACY_M',
    'ACCURACY_BUFFER_M', 'MAX_LOCATION_AGE_SECONDS', 'MAX_SPEED_MPS', 'MIN_AGE',
    'MAX_TAGS_PER_USER', 'CHAT_REQUEST_EXPIRY_MINUTES', 'MAX_PENDING_OUTGOING_REQUESTS',
    'KICK_COOLDOWN_HOURS', 'REPORT_EVIDENCE_ENABLED', 'REPORT_EVIDENCE_MESSAGES',
    'REPORT_EVIDENCE_RETENTION_DAYS', 'SMS_PROVIDER', 'SMS_DAILY_CAP', 'SMS_ALERT_AT',
    'OTP_PER_PHONE_PER_HOUR')),
  36,
  'all 36 settings from migration 0001 are present'
);

select is(
  (select value from public.app_settings where key = 'PAYMENTS_ENABLED'),
  'false'::jsonb,
  'payments are switched off by default'
);

select is(
  (select value from public.app_settings where key = 'SCAN_FEE_PAISE'),
  '1900'::jsonb,
  'scan fee defaults to 1900 paise (₹19)'
);

select throws_ok(
  $$update public.app_settings set value = '"abc"' where key = 'SCAN_FEE_PAISE'$$,
  '23514', null,
  'an integer setting rejects a string'
);

select throws_ok(
  $$update public.app_settings set value = '19.5' where key = 'SCAN_FEE_PAISE'$$,
  '23514', null,
  'an integer setting rejects a fraction'
);

select throws_ok(
  $$update public.app_settings set value = '0' where key = 'GEOFENCE_RADIUS_M'$$,
  '23514', null,
  'a setting rejects a value below its minimum'
);

select throws_ok(
  $$update public.app_settings set value = '17' where key = 'MIN_AGE'$$,
  '23514', null,
  'MIN_AGE can never go below 18'
);

select throws_ok(
  $$update public.app_settings set value = '"carrier_pigeon"' where key = 'SMS_PROVIDER'$$,
  '23514', null,
  'a text setting rejects a value outside its allowed list'
);

select throws_ok(
  $$update public.app_settings set value = '1' where key = 'PAYMENTS_ENABLED'$$,
  '23514', null,
  'a boolean setting rejects a number'
);

-- is_admin() -------------------------------------------------------------------
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'admin@test.introchat');
insert into public.admins (user_id, email)
values ('00000000-0000-4000-8000-000000000001', 'admin@test.introchat');

select is(public.is_admin(), false, 'is_admin() is false with no signed-in user');

-- DO blocks, not SELECT: a bare select would print its value into the TAP output.
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
end $$;
select is(public.is_admin(), false, 'an admin without MFA (aal1) is not treated as admin');

do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
end $$;
select is(public.is_admin(), true, 'an active admin with MFA (aal2) is admin');

update public.admins set is_active = false where user_id = '00000000-0000-4000-8000-000000000001';
select is(public.is_admin(), false, 'a deactivated admin is not admin, even with MFA');

do $$ begin perform set_config('request.jwt.claims', '', true); end $$;

-- audit_log --------------------------------------------------------------------
select lives_ok(
  $$select public.write_audit('system', null, 'test.event')$$,
  'write_audit records a system event'
);

select throws_ok(
  $$update public.audit_log set action = 'test.changed'$$,
  'P0001', 'AUDIT_LOG_IMMUTABLE',
  'audit rows cannot be updated'
);

select throws_ok(
  $$delete from public.audit_log$$,
  'P0001', 'AUDIT_LOG_IMMUTABLE',
  'audit rows younger than 2 years cannot be deleted'
);

select throws_ok(
  $$select public.write_audit('system', '00000000-0000-4000-8000-000000000001', 'test.event')$$,
  '23514', null,
  'a system event cannot carry an actor id'
);

-- check_rate_limit() -----------------------------------------------------------
-- now() is fixed for the whole transaction, so all three calls share one window.
select lives_ok(
  $$select public.check_rate_limit('test:rate', 2, interval '1 minute')$$,
  'first call within the limit passes'
);

select lives_ok(
  $$select public.check_rate_limit('test:rate', 2, interval '1 minute')$$,
  'second call within the limit passes'
);

select throws_ok(
  $$select public.check_rate_limit('test:rate', 2, interval '1 minute')$$,
  'P0001', 'RATE_LIMITED',
  'the call over the limit raises RATE_LIMITED'
);

select * from finish();
rollback;
