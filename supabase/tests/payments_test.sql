-- =============================================================================
-- Migration payments_credits: entry fee, continue, subscription (bought at
-- entry and mid-session), scan credits and their ledger, payment grace, free
-- resume, unused fees, subscriber chat history, stale checkouts, refunds,
-- grants and the global settings editor. Rolled back at the end.
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
select plan(64);

-- The defaults these tests expect, whatever dev is set to. Rolled back.
update public.app_settings set value = v.value from (values
  ('PAYMENTS_ENABLED', 'false'::jsonb), ('SCAN_FEE_ENABLED', 'true'), ('SUBSCRIPTION_ENABLED', 'true'),
  ('SCAN_FEE_PAISE', '1900'), ('CONTINUE_FEE_PAISE', '1900'), ('SUBSCRIPTION_PRICE_PAISE', '40000'),
  ('SCAN_SESSION_MINUTES', '60'), ('CONTINUE_MINUTES', '60'), ('SUBSCRIPTION_SCANS', '25'),
  ('SUBSCRIPTION_SESSION_MINUTES', '120'), ('FREE_SESSION_MINUTES', '60'), ('WARNING_BEFORE_MINUTES', '15'),
  ('PAYMENT_GRACE_SECONDS', '300'), ('UNUSED_FEE_VALID_MINUTES', '30')) v(key, value)
where app_settings.key = v.key;

-- pay-cafe has payments on; free-cafe keeps the default (off).
insert into public.venues (id, slug, name, type, latitude, longitude, is_active) values
  ('60000000-0000-4000-8000-000000000001', 'pay-cafe',  'Pay Cafe',  'cafe', 23.022500, 72.571400, true),
  ('60000000-0000-4000-8000-000000000002', 'free-cafe', 'Free Cafe', 'cafe', 23.030000, 72.580000, true);
insert into public.tables (venue_id, label, qr_token) values
  ('60000000-0000-4000-8000-000000000001', 'T1', 'PayTestToken0001'),
  ('60000000-0000-4000-8000-000000000002', 'T1', 'PayTestToken0002');
insert into public.venue_settings (venue_id, key, value)
values ('60000000-0000-4000-8000-000000000001', 'PAYMENTS_ENABLED', 'true');

-- Three onboarded guests and an admin.
insert into auth.users (id, phone)
select ('00000000-0000-4000-8000-00000000006' || n)::uuid, '91900000006' || n from generate_series(1, 3) n;
update public.profiles set consent_at = now(), consent_version = public.setting('CONSENT_VERSION') #>> '{}', birth_year = 1995
where id::text like '00000000-0000-4000-8000-00000000006_';
insert into public.tags (name) values ('music') on conflict (name) do nothing;
insert into public.user_tags (user_id, tag_id)
select p.id, t.id from public.profiles p, public.tags t
where p.id::text like '00000000-0000-4000-8000-00000000006_' and t.name = 'music';
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a9', 'payadmin@test.introchat');
insert into public.admins (user_id, email) values ('00000000-0000-4000-8000-0000000000a9', 'payadmin@test.introchat');

create function pg_temp.guest(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-00000000006' || n)::uuid;
$$;
create function pg_temp.act_as(p_user uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
create function pg_temp.start(p_slug text, p_lat double precision default 23.0225, p_lng double precision default 72.5714)
returns public.session_state language sql as $$
  select public.start_session(p_slug, case p_slug when 'pay-cafe' then 'PayTestToken0001' else 'PayTestToken0002' end,
                              p_lat, p_lng, 10, 1, 'test-device-0001');
$$;
-- Payment for a guest, at entry (with a scanned table) or in their session.
create function pg_temp.prep(p_user uuid, p_purpose text, p_slug text default null,
                             p_lat double precision default 23.0225)
returns uuid language sql as $$
  select payment_id from public.prepare_payment(p_user, p_purpose, p_slug,
    case p_slug when 'pay-cafe' then 'PayTestToken0001' when 'free-cafe' then 'PayTestToken0002' end,
    p_lat, 72.5714, 10, 1, 'test-device-0001');
$$;
create function pg_temp.pay(p_payment uuid) returns text language sql as $$
  select public.apply_payment(p_payment, 'pay_' || substr(md5(p_payment::text), 1, 14),
    (select amount_paise from public.payments where id = p_payment), '{"source": "test"}');
$$;
create function pg_temp.live(p_user uuid) returns public.sessions language sql as $$
  select * from public.sessions where user_id = p_user and status <> 'ended';
$$;
create function pg_temp.credits(p_user uuid) returns integer language sql as $$
  select scan_credits from public.profiles where id = p_user;
$$;

-- Payments off ---------------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.guest(3)); end $$;
select is((pg_temp.start('free-cafe', 23.03, 72.58)).kind, 'free', 'with payments off, entry is free as before');

-- Entry fee ------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.guest(1)); end $$;
select throws_ok($$select pg_temp.start('pay-cafe')$$, 'P0001', 'PAYMENT_REQUIRED',
  'with the scan fee on, entry without paying is refused');
select throws_ok($$select pg_temp.prep(pg_temp.guest(1), 'scan_fee', 'pay-cafe', 23.0325)$$, 'P0001', 'NOT_AT_VENUE',
  'nobody pays from outside and is then refused at the door');
create temporary table pay_entry on commit drop as select pg_temp.prep(pg_temp.guest(1), 'scan_fee', 'pay-cafe') as id;
select is((select amount_paise from public.payments where id = (select id from pay_entry)), 1900,
  'the entry fee comes from settings (₹19), never from the phone');
select throws_ok($$select public.apply_payment((select id from pay_entry), 'pay_x', 100, '{}')$$, 'P0001',
  'PAYMENT_AMOUNT_MISMATCH', 'a paid amount that differs from the order is refused');
select is(pg_temp.pay((select id from pay_entry)), 'applied', 'the payment is applied');
select is(pg_temp.pay((select id from pay_entry)), 'already_applied',
  'verify and webhook both arriving apply it once');
create temporary table s_paid on commit drop as select * from pg_temp.start('pay-cafe');
select is((select kind from s_paid), 'paid_scan', 'the paid entry starts a paid session');
select is((select expires_at - started_at from s_paid), interval '60 minutes', 'of SCAN_SESSION_MINUTES');
select is((select session_id from public.payments where id = (select id from pay_entry)), (select session_id from s_paid),
  'the payment is recorded as used by that session');
select throws_ok($$select pg_temp.prep(pg_temp.guest(1), 'scan_fee', 'pay-cafe')$$, 'P0001', 'PAYMENT_NOT_NEEDED',
  'no second entry fee while already in a session here');
insert into public.venue_settings (venue_id, key, value)
values ('60000000-0000-4000-8000-000000000001', 'SCAN_FEE_PAISE', '2500');
create temporary table pay_g2 on commit drop as select pg_temp.prep(pg_temp.guest(2), 'scan_fee', 'pay-cafe') as id;
select is((select amount_paise from public.payments where id = (select id from pay_g2)), 2500,
  'a venue''s own price applies');

-- Continue -------------------------------------------------------------------------
select throws_ok($$select pg_temp.prep(pg_temp.guest(1), 'continue')$$, 'P0001', 'CONTINUE_NOT_AVAILABLE',
  'paying to continue is offered only from the warning on');
update public.sessions set expires_at = now() + interval '10 minutes' where id = (pg_temp.live(pg_temp.guest(1))).id;
create temporary table pay_cont on commit drop as select pg_temp.prep(pg_temp.guest(1), 'continue') as id;
select is(pg_temp.pay((select id from pay_cont)), 'applied', 'a continue payment is applied');
select is((pg_temp.live(pg_temp.guest(1))).expires_at, now() + interval '70 minutes',
  'it adds CONTINUE_MINUTES to the current end');

update public.sessions
set status = 'final_prompt', expires_at = now() - interval '1 second', final_deadline_at = now() + interval '30 seconds',
    payment_grace_used = false
where id = (pg_temp.live(pg_temp.guest(1))).id;
create temporary table pay_grace on commit drop as select pg_temp.prep(pg_temp.guest(1), 'continue') as id;
select is((pg_temp.live(pg_temp.guest(1))).final_deadline_at, now() + interval '300 seconds',
  'starting to pay in the final prompt gives PAYMENT_GRACE_SECONDS');
select is((pg_temp.live(pg_temp.guest(1))).payment_grace_used, true, 'once per block');

-- Subscription bought mid-session (decision 12) --------------------------------------
update public.sessions set block_started_at = now() - interval '60 minutes' where id = (pg_temp.live(pg_temp.guest(1))).id;
create temporary table pay_sub on commit drop as select pg_temp.prep(pg_temp.guest(1), 'subscription') as id;
select is((select amount_paise from public.payments where id = (select id from pay_sub)), 40000, 'the subscription costs ₹400');
select is(pg_temp.pay((select id from pay_sub)), 'applied', 'the subscription is applied');
select is(pg_temp.credits(pg_temp.guest(1)), 24, '25 scans, one used at once for the current session');
select is((pg_temp.live(pg_temp.guest(1))).kind, 'subscription', 'the session becomes a subscription session');
select is((pg_temp.live(pg_temp.guest(1))).status, 'active', 'out of the final prompt');
select is((pg_temp.live(pg_temp.guest(1))).expires_at, now() + interval '60 minutes',
  'lasting 2 hours from the start of its block');
select is((select sum(delta)::integer from public.credit_ledger where user_id = pg_temp.guest(1)), 24,
  'the ledger adds up to the balance');
select throws_ok($$update public.profiles set scan_credits = 99 where id = pg_temp.guest(1)$$, 'P0001',
  'SCAN_CREDITS_LEDGER_ONLY', 'the balance cannot be changed except through the ledger');
select throws_ok($$select pg_temp.prep(pg_temp.guest(1), 'continue')$$, 'P0001', 'PAYMENT_NOT_NEEDED',
  'a guest with scans continues with a scan, not money');

-- Continue with a scan ---------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.guest(1)); end $$;
select throws_ok($$select public.continue_with_credit()$$, 'P0001', 'CONTINUE_NOT_AVAILABLE',
  'continuing with a scan is offered only from the warning on');
update public.sessions set expires_at = now() + interval '5 minutes' where id = (pg_temp.live(pg_temp.guest(1))).id;
select is((public.continue_with_credit()).scan_credits, 23, 'continuing uses one scan');
select is((pg_temp.live(pg_temp.guest(1))).expires_at, now() + interval '125 minutes',
  'and adds SUBSCRIPTION_SESSION_MINUTES');

-- Chat history, free resume, kicks --------------------------------------------------
insert into public.conversations (id, user_low_id, user_high_id)
values ('61000000-0000-4000-8000-000000000001', pg_temp.guest(1), pg_temp.guest(2));
insert into public.conversation_members (conversation_id, user_id) values
  ('61000000-0000-4000-8000-000000000001', pg_temp.guest(1)),
  ('61000000-0000-4000-8000-000000000001', pg_temp.guest(2));
create temporary table s_left on commit drop as select (pg_temp.live(pg_temp.guest(1))).id;
select lives_ok($$select public.end_session((select id from s_left), 'user_logout')$$, 'the subscriber logs out early');
select is((select hidden_at from public.conversation_members
           where conversation_id = '61000000-0000-4000-8000-000000000001' and user_id = pg_temp.guest(1)), null,
  'a subscriber keeps their chats after the visit');

create temporary table s_resumed on commit drop as select * from pg_temp.start('pay-cafe');
select is((select resumed_from from public.sessions where id = (select session_id from s_resumed)), (select id from s_left),
  'coming back within the paid time resumes the session for free');
select is(pg_temp.credits(pg_temp.guest(1)), 23, 'without using a scan');
select is((select expires_at from s_resumed), now() + interval '125 minutes', 'and with the same end');
select throws_ok($$insert into public.sessions (user_id, venue_id, kind, expires_at, location_state, resumed_from, status, ended_at, end_reason)
                  values (pg_temp.guest(1), '60000000-0000-4000-8000-000000000001', 'free', now(), 'inside',
                          (select id from s_left), 'ended', now(), 'expired')$$,
  '23505', null, 'an ended session can be resumed only once');

select lives_ok($$select public.end_session((pg_temp.live(pg_temp.guest(1))).id, 'kicked')$$, 'the guest is kicked');
create temporary table s_after_kick on commit drop as select * from pg_temp.start('pay-cafe');
select is((select resumed_from from public.sessions where id = (select session_id from s_after_kick)), null,
  'no free resume after a kick');
select is(pg_temp.credits(pg_temp.guest(1)), 22, 'entering again uses a scan');
select is((select kind from s_after_kick), 'subscription', 'for a subscription session');
select is((select expires_at - started_at from s_after_kick), interval '120 minutes', 'of 2 hours');

-- Unused fees ------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as(pg_temp.guest(2)); end $$;
select is(pg_temp.pay((select id from pay_g2)), 'applied', 'guest 2 pays but the app closes before joining');
update public.payments set paid_at = now() - interval '31 minutes' where id = (select id from pay_g2);
select throws_ok($$select pg_temp.start('pay-cafe')$$, 'P0001', 'PAYMENT_REQUIRED',
  'an entry fee unused for UNUSED_FEE_VALID_MINUTES is no longer valid');
update public.payments set paid_at = now() - interval '5 minutes' where id = (select id from pay_g2);
select is((pg_temp.start('pay-cafe')).kind, 'paid_scan', 'within that time, joining uses it: no second charge');

select lives_ok($$select public.end_session((pg_temp.live(pg_temp.guest(2))).id, 'user_logout')$$, 'guest 2 leaves');
select isnt((select hidden_at from public.conversation_members
             where conversation_id = '61000000-0000-4000-8000-000000000001' and user_id = pg_temp.guest(2)), null,
  'a guest without a subscription loses their chats');
select is((select count(*)::integer from public.conversations where id = '61000000-0000-4000-8000-000000000001'), 1,
  'the conversation stays while the subscriber still sees it');

-- Switches -----------------------------------------------------------------------------
insert into public.venue_settings (venue_id, key, value)
values ('60000000-0000-4000-8000-000000000001', 'SUBSCRIPTION_ENABLED', 'false');
select throws_ok($$select pg_temp.prep(pg_temp.guest(2), 'subscription', 'pay-cafe')$$, 'P0001', 'FEATURE_DISABLED',
  'no subscription is sold where it is switched off');
delete from public.venue_settings where venue_id = '60000000-0000-4000-8000-000000000001' and key = 'SUBSCRIPTION_ENABLED';

-- Stale checkouts --------------------------------------------------------------------
create temporary table pay_stale on commit drop as select pg_temp.prep(pg_temp.guest(3), 'subscription', 'pay-cafe') as id;
update public.payments set created_at = now() - interval '25 hours' where id = (select id from pay_stale);
select ok((public.hourly_cleanup() ->> 'payments_failed')::integer >= 1, 'a checkout unfinished after 24 h is marked failed');
select is(pg_temp.pay((select id from pay_stale)), 'applied', 'a late success is still applied: the money was taken');
select is(pg_temp.credits(pg_temp.guest(3)), 25,
  'a subscription bought for another venue than the live session gives scans only');

-- Admin --------------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000a9', 'aal2'); end $$;
select throws_ok(format($$select public.admin_mark_payment_refunded(%L, '  ')$$, (select id from pay_sub)),
  'P0001', 'VALIDATION_FAILED', 'a refund needs a note');
select lives_ok(format($$select public.admin_mark_payment_refunded(%L, 'Guest asked for a refund')$$, (select id from pay_sub)),
  'an admin records a subscription refund');
select is(pg_temp.credits(pg_temp.guest(1)), 0, 'its unused scans are removed (never below 0)');
select throws_ok(format($$select public.admin_mark_payment_refunded(%L, 'again')$$, (select id from pay_sub)),
  'P0001', 'PAYMENT_NOT_REFUNDABLE', 'a payment is refunded once');
select is(public.admin_grant_scans(pg_temp.guest(1), 5, 'Goodwill after a problem'), 5, 'an admin grants scans');
select is((select admin_id from public.credit_ledger where user_id = pg_temp.guest(1) and reason = 'admin_grant'),
  '00000000-0000-4000-8000-0000000000a9'::uuid, 'recorded with who granted them');
select is((select handle from public.admin_find_guest(upper((select handle from public.profiles where id = pg_temp.guest(1)))))
          , (select handle from public.profiles where id = pg_temp.guest(1)), 'an admin finds a guest by handle, any case');
select throws_ok($$select public.admin_set_app_setting('CONSENT_VERSION', '"v2"')$$, 'P0001', 'SETTING_NOT_EDITABLE',
  'settings that must change with the code cannot be edited in the Console');
select throws_ok($$select public.admin_set_app_setting('PAYMENTS_ENABLED', '"yes"')$$, 'P0001', 'SETTING_VALUE_INVALID',
  'a value of the wrong type is refused');
select lives_ok($$select public.admin_set_app_setting('CONTINUE_FEE_PAISE', '2900')$$, 'an admin changes a price');
select is(public.setting_int('CONTINUE_FEE_PAISE'), 2900, 'and it takes effect');

do $$ begin perform pg_temp.act_as('00000000-0000-4000-8000-0000000000a9', 'aal1'); end $$;
select throws_ok($$select * from public.admin_list_payments()$$, 'P0001', 'FORBIDDEN',
  'the payments list needs the 2-step admin login');

-- Access -------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated',
  'public.apply_payment(uuid, text, integer, jsonb)', 'execute'), 'guests cannot apply payments');
select ok(not has_function_privilege('authenticated',
  'public.prepare_payment(uuid, text, text, text, double precision, double precision, double precision, double precision, text)',
  'execute'), 'guests cannot create payments directly');

select * from finish();
rollback;
