-- =============================================================================
-- Migration 0003: guest entry points (venue_public, location_check) and the
-- admin venue/table functions. Rolled back at the end.
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
select plan(32);

-- An admin, and helpers to act as them (aal2 = MFA done) or as nobody.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'admin@test.introchat');
insert into public.admins (user_id, email) values ('00000000-0000-4000-8000-0000000000a1', 'admin@test.introchat');

create function pg_temp.act_as(p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_aal is null then ''
         else json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', p_aal)::text
    end, true);
end $$;

create function pg_temp.venue_id() returns uuid language sql as $$
  select id from public.venues where slug = 'api-cafe'
$$;
create function pg_temp.token(p_label text) returns text language sql as $$
  select qr_token from public.tables where venue_id = pg_temp.venue_id() and label = p_label
$$;

-- Grants ------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.venue_public(text, text)', 'EXECUTE'),
  'anon can call venue_public');
select ok(not has_function_privilege('anon', 'public.admin_list_venues()', 'EXECUTE'),
  'anon cannot call admin functions at all');

-- Admin access ------------------------------------------------------------------
do $$ begin perform pg_temp.act_as(null); end $$;
select throws_ok($$select * from public.admin_list_venues()$$, 'P0001', 'FORBIDDEN',
  'admin functions refuse a caller who is not signed in');

do $$ begin perform pg_temp.act_as('aal1'); end $$;
select throws_ok($$select * from public.admin_list_venues()$$, 'P0001', 'FORBIDDEN',
  'admin functions refuse an admin who has not completed MFA');

do $$ begin perform pg_temp.act_as('aal2'); end $$;

-- Venues ------------------------------------------------------------------------
select lives_ok(
  $$select public.admin_create_venue('API-Cafe ', ' Api Café ', 'cafe', '', 'Ahmedabad', 23.0225, 72.5714)$$,
  'an admin with MFA can create a venue'
);
select is((select name from public.venues where id = pg_temp.venue_id()), 'Api Café',
  'slug is lower-cased and the name trimmed');
select is(
  (select count(*)::integer from public.audit_log
   where action = 'venue.create' and actor_id = '00000000-0000-4000-8000-0000000000a1'
     and venue_id = pg_temp.venue_id()),
  1, 'creating a venue is audit-logged with the admin as actor'
);
select throws_ok(
  $$select public.admin_create_venue('api-cafe', 'Other', 'cafe', null, null, 23.0, 72.5)$$,
  'P0001', 'SLUG_TAKEN', 'a duplicate slug gets SLUG_TAKEN'
);
select throws_ok(
  $$select public.admin_create_venue('bar-one', 'Bar', 'bar', null, null, 23.0, 72.5)$$,
  'P0001', 'VALIDATION_FAILED', 'an invalid venue type gets VALIDATION_FAILED'
);
select throws_ok(
  $$select public.admin_set_venue_pin(pg_temp.venue_id(), 0, 0)$$,
  'P0001', 'VALIDATION_FAILED', 'a pin outside India gets VALIDATION_FAILED'
);
select throws_ok(
  $$select public.admin_set_venue_active(pg_temp.venue_id(), true)$$,
  'P0001', 'VENUE_HAS_NO_TABLES', 'a venue with no tables cannot be activated'
);

-- Tables ------------------------------------------------------------------------
select is(public.admin_create_tables(pg_temp.venue_id(), array['T01', 'T02', ' T03 ']), 3,
  'tables are created in bulk');
select throws_ok(
  $$select public.admin_create_tables(pg_temp.venue_id(), array['T01'])$$,
  'P0001', 'TABLE_LABEL_TAKEN', 'a duplicate table label gets TABLE_LABEL_TAKEN'
);
select lives_ok($$select public.admin_set_venue_active(pg_temp.venue_id(), true)$$,
  'a venue with tables can be activated');

-- Guest: venue_public -------------------------------------------------------------
select is(
  (select venue_name || ' / ' || table_label from public.venue_public('api-cafe', pg_temp.token('T01'))),
  'Api Café / T01', 'a valid scan returns the venue and the table'
);
select is(
  (select payments_enabled or scan_fee_enabled or subscription_enabled
   from public.venue_public('api-cafe', pg_temp.token('T01'))),
  false, 'payments are reported off by default'
);
select throws_ok($$select * from public.venue_public('api-cafe', 'AAAAAAAAAAAAAAAA')$$,
  'P0001', 'TABLE_NOT_FOUND', 'an unknown token gets TABLE_NOT_FOUND');
select throws_ok($$select * from public.venue_public('no-such-cafe', 'AAAAAAAAAAAAAAAA')$$,
  'P0001', 'VENUE_NOT_FOUND', 'an unknown slug gets VENUE_NOT_FOUND');

-- Guest: location_check -----------------------------------------------------------
select is(
  public.location_check('api-cafe', pg_temp.token('T01'), 23.0225, 72.5714, 10, 0, 'device-aaaa-0001'),
  'inside', 'a reading at the pin is inside'
);
select is(
  public.location_check('api-cafe', pg_temp.token('T01'), 23.0325, 72.5714, 10, 0, 'device-aaaa-0001'),
  'outside', 'a reading 1.1 km away is outside'
);
select throws_ok(
  $$select public.location_check('api-cafe', pg_temp.token('T01'), 23.0225, 72.5714, 10, 0, 'x')$$,
  'P0001', 'DEVICE_ID_INVALID', 'a malformed device id is refused'
);
do $$
begin
  for i in 1 .. 30 loop
    perform public.location_check('api-cafe', pg_temp.token('T01'), 23.0225, 72.5714, 10, 0, 'device-bbbb-0002');
  end loop;
end $$;
select throws_ok(
  $$select public.location_check('api-cafe', pg_temp.token('T01'), 23.0225, 72.5714, 10, 0, 'device-bbbb-0002')$$,
  'P0001', 'RATE_LIMITED', 'the 31st check in a minute from one device is refused'
);

-- Settings overrides --------------------------------------------------------------
select lives_ok($$select public.admin_set_venue_setting(pg_temp.venue_id(), 'GEOFENCE_RADIUS_M', '100')$$,
  'an admin can override the radius for one venue');
select is(
  (select override_value from public.admin_list_venue_settings(pg_temp.venue_id()) where key = 'GEOFENCE_RADIUS_M'),
  '100'::jsonb, 'the override is listed next to the global value'
);
select is(
  (select radius_m from public.admin_test_location(pg_temp.venue_id(), 23.0225, 72.5714, 5, 0)),
  100, 'the on-site test uses the venue''s own radius'
);
select throws_ok(
  $$select public.admin_set_venue_setting(pg_temp.venue_id(), 'MIN_AGE', '21')$$,
  'P0001', 'SETTING_NOT_OVERRIDABLE', 'a global-only setting cannot be overridden from the Console'
);

-- QR regeneration -----------------------------------------------------------------
create temporary table old_token on commit drop as select pg_temp.token('T02') as v;
select lives_ok(
  $$select public.admin_regenerate_qr_token((select id from public.tables where venue_id = pg_temp.venue_id() and label = 'T02'))$$,
  'a table''s QR token can be regenerated'
);
select throws_ok($$select * from public.venue_public('api-cafe', (select v from old_token))$$,
  'P0001', 'TABLE_NOT_FOUND', 'the old printed card stops working');
select is(
  (select meta from public.audit_log where action = 'table.qr_regenerate' order by id desc limit 1),
  '{}'::jsonb, 'the new token is never written to the audit log'
);

-- Closing and deactivating ----------------------------------------------------------
update public.tables set is_active = false where venue_id = pg_temp.venue_id() and label = 'T03';
select throws_ok($$select * from public.venue_public('api-cafe', pg_temp.token('T03'))$$,
  'P0001', 'TABLE_NOT_FOUND', 'a deactivated table''s card is refused');

update public.venues set closed_until = now() + interval '1 hour' where id = pg_temp.venue_id();
select throws_ok($$select * from public.venue_public('api-cafe', pg_temp.token('T01'))$$,
  'P0001', 'VENUE_CLOSED', 'a venue closed for today refuses scans');

update public.venues set closed_until = null, is_active = false where id = pg_temp.venue_id();
select throws_ok($$select * from public.venue_public('api-cafe', pg_temp.token('T01'))$$,
  'P0001', 'VENUE_NOT_FOUND', 'an inactive venue looks like an unknown one');

select * from finish();
rollback;
