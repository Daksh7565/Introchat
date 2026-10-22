-- =============================================================================
-- Migration guest_identity: phone hashing, profiles and handles, consent and
-- profile rules, tags, the OTP gatekeeper and the before-user-created hook.
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
select plan(40);

-- Guests are created the way Supabase Auth creates them: a row in auth.users.
insert into auth.users (id, phone) values
  ('00000000-0000-4000-8000-0000000000b1', '919000000011'),
  ('00000000-0000-4000-8000-0000000000b2', '919000000012');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'staff@test.introchat');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- Phone numbers -------------------------------------------------------------------
select is(public.normalize_indian_mobile('+91 98765 43210'), '919876543210', 'a +91 number with spaces is normalised');
select is(public.normalize_indian_mobile('9876543210'), '919876543210', 'a 10-digit mobile gets the 91 prefix');
select is(public.normalize_indian_mobile('+1 415 555 0000'), null, 'a non-Indian number is refused');
select is(public.normalize_indian_mobile('+91 5876543210'), null, 'an Indian number that is not a mobile is refused');
select is(public.phone_hash('+91 98765 43210'), public.phone_hash('9876543210'), 'the same number hashes the same in any format');
select ok(public.phone_hash('9876543210') ~ '^[0-9a-f]{64}$' and public.phone_hash('9876543210') !~ '9876543210',
  'the stored form is a 64-character HMAC, never the number');

-- Profiles and handles ------------------------------------------------------------
select ok(
  (select handle ~ '^[A-Z][a-z]{1,10}-[0-9]{4}$' from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  'a phone login gets a profile with a handle like Mango-4821'
);
select is((select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'an email (admin) account gets no guest profile');
select is((select phone_hash from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  public.phone_hash('919000000011'), 'the profile stores only the phone hash');

create temporary table b1_handle on commit drop as
  select handle from public.profiles where id = '00000000-0000-4000-8000-0000000000b1';

-- Consent and profile rules ---------------------------------------------------------
do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000c1'); end $$;
select throws_ok($$select * from public.my_profile()$$, 'P0001', 'NOT_A_GUEST', 'an admin account is not a guest');

do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000b1'); end $$;
select is((select profile_complete from public.my_profile()), false, 'a new guest''s profile is not complete');
select throws_ok($$select public.update_profile(1995, 'en')$$, 'P0001', 'CONSENT_REQUIRED',
  'the profile cannot be filled before consent');
select throws_ok($$select public.accept_consent('v0-old')$$, 'P0001', 'CONSENT_VERSION_OUTDATED',
  'consent to an outdated notice is refused');
select lives_ok($$select public.accept_consent('v1-draft')$$, 'consent to the current notice is recorded');
select is(public.update_profile(1995, 'gu', '  Asha  ', 'female'), 'ok', 'an adult profile is saved');
select is((select nickname from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'), 'Asha',
  'the nickname is trimmed');
select throws_ok($$select public.update_profile(2001, 'en')$$, 'P0001', 'BIRTH_YEAR_LOCKED',
  'the birth year cannot be changed once set');
select throws_ok($$select public.update_profile(1995, 'en', null, 'robot')$$, 'P0001', 'PROFILE_INVALID',
  'an unknown gender value is refused');
select is((select handle from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  (select handle from b1_handle), 'the handle never changes');

do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000b2'); end $$;
select lives_ok($$select public.accept_consent('v1-draft')$$, 'second guest consents');
select is(public.update_profile(extract(year from now())::integer - 10, 'en'), 'under_age',
  'a guest under 18 is told so');
select is((select age_blocked from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'), true,
  'the refusal is recorded, not just raised');
select throws_ok($$select public.update_profile(1990, 'en')$$, 'P0001', 'AGE_BLOCKED',
  'an age-blocked guest cannot try another year');

-- Tags --------------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000b1'); end $$;
select is(public.set_tags(array[' Football ', 'football', 'ગરબા']), array['football', 'ગરબા'],
  'tags are trimmed, lower-cased, de-duplicated, and Gujarati is kept');
select throws_ok($$select public.set_tags(array['a', 'b', 'c', 'd', 'e', 'f'])$$, 'P0001', 'TAGS_COUNT_INVALID',
  'more than 5 tags is refused');
select throws_ok($$select public.set_tags(array['chutiya fan'])$$, 'P0001', 'TAG_NOT_ALLOWED',
  'a tag containing a blocked word is refused');
select is(public.set_tags(array['class', 'football']), array['class', 'football'],
  'blocking is by whole word: "class" is not blocked by "ass"-style substrings');
select throws_ok($$select public.set_tags(array['music!!'])$$, 'P0001', 'TAG_INVALID',
  'punctuation in a tag is refused');
select is((select profile_complete from public.my_profile()), true,
  'consent + adult birth year + tags = complete profile');
select ok((select users >= 1 from public.tag_suggestions('foot') where name = 'football'),
  'suggestions match the typed prefix and count users');

-- OTP gatekeeper ------------------------------------------------------------------------
select is((select refusal from public.sms_hook_check('+1 415 555 0000')), 'PHONE_NOT_ALLOWED',
  'no OTP to a non-Indian number');
select is((select allowed from public.sms_hook_check('9000000021')), true, 'an OTP to a valid number is allowed');
do $$
begin
  for i in 1 .. 4 loop perform public.sms_hook_check('9000000021'); end loop;
end $$;
select is((select refusal from public.sms_hook_check('9000000021')), 'RATE_LIMITED',
  'the 6th OTP to one number within an hour is refused');

insert into public.bans (scope, phone_hash, reason) values ('platform', public.phone_hash('9000000022'), 'test');
select is((select refusal from public.sms_hook_check('9000000022')), 'BANNED', 'a banned phone gets no OTP');

update public.app_settings
set value = to_jsonb((select count(*) from public.sms_log
                      where status in ('pending', 'sent')
                        and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::integer)
where key = 'SMS_DAILY_CAP';
select is((select refusal from public.sms_hook_check('9000000023')), 'SMS_DAILY_LIMIT',
  'once the daily SIM cap is reached, no more OTPs are sent');
select ok(exists (select 1 from public.audit_log where action = 'sms.cap_reached'),
  'reaching the cap is recorded for the admins');

-- Before-user-created hook ------------------------------------------------------------------
select is(public.before_user_created_hook('{"user": {"email": "random@test.introchat"}}') -> 'error' ->> 'message',
  'EMAIL_SIGNUP_DISABLED', 'a public email sign-up is refused');
select is(public.before_user_created_hook('{"user": {"phone": "919000000031"}}'), '{}'::jsonb,
  'a valid, unbanned +91 phone may become an account');
select is(public.before_user_created_hook('{"user": {"phone": "14155550000"}}') -> 'error' ->> 'message',
  'PHONE_NOT_ALLOWED', 'a non-Indian phone cannot become an account');
select is(public.before_user_created_hook('{"user": {"phone": "919000000022"}}') -> 'error' ->> 'message',
  'BANNED', 'a banned phone cannot become an account');

select * from finish();
rollback;
