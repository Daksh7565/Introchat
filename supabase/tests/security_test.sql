-- =============================================================================
-- Security invariants (M8): checked for every object, so a function or table
-- added later without the rules fails here, not in production.
-- (rls_test.sql pins exactly which functions each client role may call.)
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
select plan(7);

-- Our own functions in public (not those an extension installed there).
create temporary view our_functions as
  select p.oid, p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig, p.proowner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

select is_empty(
  $$select signature from our_functions where not coalesce('search_path=""' = any (proconfig), false)$$,
  'every function in public pins search_path to empty (no schema hijacking)'
);

select is_empty(
  $$select signature from our_functions where definer and proowner <> 'postgres'::regrole$$,
  'every SECURITY DEFINER function is owned by postgres'
);

select is_empty(
  $$select signature from our_functions
    where has_function_privilege('anon', oid, 'execute')
      and signature not like 'venue_public(%' and signature not like 'location_check(%'$$,
  'signed-out visitors can call only the two scan functions'
);

select is_empty(
  $$select signature from our_functions
    where not definer and has_function_privilege('authenticated', oid, 'execute')
      and signature not like 'is_admin(%'$$,
  'every function a signed-in user can call runs as SECURITY DEFINER (tables stay closed to them)'
);

select is_empty(
  $$select table_name || ' ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')$$,
  'no table or view in public is granted to anon or authenticated'
);

select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'usage'))$$,
  'no sequence in public is usable by anon or authenticated'
);

select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname not in ('introchat_receive', 'introchat_send_typing')$$,
  'Realtime has only our two policies (receive own topics, send typing)'
);

select * from finish();
rollback;
