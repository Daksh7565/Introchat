-- =============================================================================
-- Access model: the guarantees every migration must keep.
--
-- These checks scan the WHOLE public schema, so they also cover tables and
-- functions that later migrations add. When a migration deliberately grants a
-- function to anon or authenticated, add its name to the matching list below,
-- in the same change. A failure here means something became reachable from a
-- guest's phone that was not meant to be.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Functions anon may call. Empty until M1 adds venue_public / location_check.
create temporary table expected_anon_functions (name text primary key) on commit drop;

-- Functions authenticated users may call.
create temporary table expected_authenticated_functions (name text primary key) on commit drop;
insert into expected_authenticated_functions (name) values ('is_admin');

-- Tables -----------------------------------------------------------------------
select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public'),
  0,
  'no RLS policies exist in public: clients reach data only through functions'
);

select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))),
  0,
  'anon and authenticated hold no privileges on any table or view in public'
);

select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
       or has_sequence_privilege('authenticated', c.oid, 'USAGE, SELECT, UPDATE'))),
  0,
  'anon and authenticated hold no privileges on any sequence in public'
);

-- Functions --------------------------------------------------------------------
select set_eq(
  $$select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  $$select name from expected_anon_functions$$,
  'anon can execute exactly the expected functions'
);

select set_eq(
  $$select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  $$select name from expected_authenticated_functions$$,
  'authenticated can execute exactly the expected functions'
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  0,
  'every function in public pins search_path to empty'
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('public', p.oid, 'EXECUTE')),
  0,
  'no function in public is executable by PUBLIC'
);

select * from finish();
rollback;
