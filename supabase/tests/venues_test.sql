-- =============================================================================
-- Migration 0002: venues, venue_settings, tables, setting lookup, location rule.
-- Rolled back at the end: nothing is left on the project the tests run against.
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
select plan(30);

-- A venue at a fixed pin. 1 m north = 1 / 111194.93 degrees of latitude for the
-- 6 371 000 m Earth radius the rule uses, so test points sit at exact distances.
insert into public.venues (id, slug, name, type, latitude, longitude)
values ('10000000-0000-4000-8000-000000000001', 'test-cafe', 'Test Café', 'cafe', 23.022500, 72.571400);

create temporary table m_per_degree (v double precision) on commit drop;
insert into m_per_degree values (111194.93);

create function pg_temp.at(metres_north double precision, accuracy double precision, age double precision default 0)
returns text
language sql
as $$
  select state from public.evaluate_location(
    '10000000-0000-4000-8000-000000000001',
    23.0225 + metres_north / (select v from m_per_degree),
    72.5714,
    accuracy,
    age
  );
$$;

-- haversine -------------------------------------------------------------------
select ok(
  public.haversine_m(23.0225, 72.5714, 23.0235, 72.5714) between 111.1 and 111.3,
  '0.001 degree of latitude is about 111.2 m'
);

-- Location rule: same 8 cases as the field-test page (radius 40, max acc 60, buffer 15)
select is(pg_temp.at(10, 20), 'inside', '10 m away, ±20 m → inside');
select is(pg_temp.at(50, 10), 'inside', '50 m away, ±10 m → inside (radius + buffered accuracy)');
select is(pg_temp.at(60, 10), 'outside', '60 m away, ±10 m → outside');
select is(pg_temp.at(45, 20), 'inside', '45 m away, ±20 m → inside (buffer capped at 15)');
select is(pg_temp.at(70, 20), 'outside', '70 m away, ±20 m → outside');
select is(pg_temp.at(56, 20), 'unknown', '56 m away, ±20 m → unknown (could be either)');
select is(pg_temp.at(10, 80), 'unknown', 'accuracy worse than 60 m → unknown');
select is(pg_temp.at(10, 20, 200), 'unknown', 'reading older than 120 s → unknown');

select is(
  (select distance_m from public.evaluate_location('10000000-0000-4000-8000-000000000001', 23.0225 + 30 / 111194.93, 72.5714, 5, 0)),
  30,
  'distance is reported in whole metres'
);

select throws_ok(
  $$select * from public.evaluate_location('10000000-0000-4000-8000-000000000001', 'NaN', 72.5, 10, 0)$$,
  'P0001', 'LOCATION_INVALID', 'NaN latitude is rejected'
);
select throws_ok(
  $$select * from public.evaluate_location('10000000-0000-4000-8000-000000000001', 23.0, 72.5, -1, 0)$$,
  'P0001', 'LOCATION_INVALID', 'negative accuracy is rejected'
);
select throws_ok(
  $$select * from public.evaluate_location('10000000-0000-4000-8000-0000000000ff', 23.0, 72.5, 10, 0)$$,
  'P0001', 'VENUE_NOT_FOUND', 'an unknown venue is rejected'
);

-- Settings: overrides and typed lookup ------------------------------------------
select is(public.setting_int('GEOFENCE_RADIUS_M', '10000000-0000-4000-8000-000000000001'), 40,
  'without an override a venue gets the global value');

insert into public.venue_settings (venue_id, key, value)
values ('10000000-0000-4000-8000-000000000001', 'GEOFENCE_RADIUS_M', '100');

select is(public.setting_int('GEOFENCE_RADIUS_M', '10000000-0000-4000-8000-000000000001'), 100,
  'a venue override wins for that venue');
select is(public.setting_int('GEOFENCE_RADIUS_M'), 40, 'the global value is unchanged');
select is(pg_temp.at(90, 10), 'inside', 'the location rule uses the venue''s own radius');

select throws_ok(
  $$insert into public.venue_settings (venue_id, key, value)
    values ('10000000-0000-4000-8000-000000000001', 'MIN_AGE', '21')$$,
  'P0001', 'SETTING_NOT_OVERRIDABLE', 'a global-only setting cannot be overridden per venue'
);
select throws_ok(
  $$update public.venue_settings set value = '5'
    where venue_id = '10000000-0000-4000-8000-000000000001' and key = 'GEOFENCE_RADIUS_M'$$,
  'P0001', 'SETTING_VALUE_INVALID', 'an override outside the setting''s bounds is rejected'
);
select throws_ok(
  $$insert into public.venue_settings (venue_id, key, value)
    values ('10000000-0000-4000-8000-000000000001', 'NOT_A_SETTING', '1')$$,
  'P0001', 'UNKNOWN_SETTING', 'an override for an unknown key is rejected'
);
select throws_ok($$select public.setting('NOT_A_SETTING')$$, 'P0001', 'UNKNOWN_SETTING',
  'looking up an unknown key fails loudly');
select throws_ok($$select public.setting_bool('GEOFENCE_RADIUS_M')$$, 'P0001', 'SETTING_TYPE_MISMATCH',
  'reading an integer setting as a boolean fails loudly');
select is(public.setting_bool('PAYMENTS_ENABLED'), false, 'setting_bool reads a boolean');

-- Venue validation --------------------------------------------------------------
select throws_ok(
  $$insert into public.venues (slug, name, type, latitude, longitude) values ('sea-cafe', 'Sea', 'cafe', 0, 0)$$,
  '23514', null, 'a pin outside India is rejected'
);
select throws_ok(
  $$insert into public.venues (slug, name, type, latitude, longitude) values ('-bad', 'Bad', 'cafe', 23, 72.5)$$,
  '23514', null, 'a slug starting with a hyphen is rejected'
);
select throws_ok(
  $$insert into public.venues (slug, name, type, latitude, longitude, timezone)
    values ('tz-cafe', 'Tz', 'cafe', 23, 72.5, 'Mars/Olympus')$$,
  'P0001', 'INVALID_TIMEZONE', 'an unknown timezone is rejected'
);
select is((select is_active from public.venues where slug = 'test-cafe'), false,
  'a new venue starts inactive');

-- Tables and QR tokens ----------------------------------------------------------
insert into public.tables (venue_id, label) values
  ('10000000-0000-4000-8000-000000000001', 'Table 1'),
  ('10000000-0000-4000-8000-000000000001', 'Table 2');

select is(
  (select count(*)::integer from public.tables where qr_token ~ '^[A-Za-z0-9]{16}$'),
  2,
  'every table gets a 16-character token'
);
select is(
  (select count(distinct qr_token)::integer from public.tables),
  2,
  'tokens are distinct'
);
select throws_ok(
  $$insert into public.tables (venue_id, label) values ('10000000-0000-4000-8000-000000000001', 'Table 1')$$,
  '23505', null, 'a label is unique within its venue'
);

select * from finish();
rollback;
