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
select plan(8);

-- Functions anon may call: only what the landing page needs before login.
create temporary table expected_anon_functions (name text primary key) on commit drop;
insert into expected_anon_functions (name) values ('venue_public'), ('location_check');

-- Functions authenticated users may call. Every admin_* function refuses
-- non-admins inside (require_admin), but the grant itself is listed here.
create temporary table expected_authenticated_functions (name text primary key) on commit drop;
insert into expected_authenticated_functions (name) values
  ('is_admin'),
  ('venue_public'),
  ('location_check'),
  ('admin_list_venues'),
  ('admin_get_venue'),
  ('admin_create_venue'),
  ('admin_update_venue'),
  ('admin_set_venue_pin'),
  ('admin_set_venue_active'),
  ('admin_list_venue_settings'),
  ('admin_set_venue_setting'),
  ('admin_clear_venue_setting'),
  ('admin_list_tables'),
  ('admin_create_tables'),
  ('admin_update_table'),
  ('admin_regenerate_qr_token'),
  ('admin_test_location'),
  -- Guest profile (migration guest_identity); each refuses non-guests inside.
  ('my_profile'),
  ('accept_consent'),
  ('update_profile'),
  ('tag_suggestions'),
  ('set_tags'),
  -- Sessions (migration sessions); each acts only on the caller's own session.
  ('my_session'),
  ('start_session'),
  ('heartbeat'),
  ('continue_free'),
  ('end_my_session'),
  -- Payments (migration payments_credits). Guests: their own session only;
  -- admin_*: require_admin() first. prepare_payment / apply_payment and the
  -- other payment functions are service_role only and must NOT be listed here.
  ('continue_with_credit'),
  -- Safety (migration safety). Guests: only people they can see; admin_*:
  -- require_admin() first.
  ('block_person'),
  -- Console operations and account deletion (migration console_ops).
  ('admin_live_guests'),
  ('admin_kick'),
  ('admin_close_venue_today'),
  ('admin_reopen_venue'),
  ('admin_list_spoof_flags'),
  ('admin_stats'),
  ('admin_list_audit'),
  ('admin_sms_usage'),
  ('admin_list_admins'),
  ('admin_add_admin'),
  ('admin_set_admin_active'),
  ('admin_list_deletion_requests'),
  ('admin_process_deletion'),
  ('my_deletion_request'),
  ('request_account_deletion'),
  ('cancel_account_deletion'),
  ('report_person'),
  ('admin_list_reports'),
  ('admin_report_evidence'),
  ('admin_resolve_report'),
  ('admin_ban_guest'),
  ('admin_list_bans'),
  ('admin_lift_ban'),
  ('admin_list_tags'),
  ('admin_set_tag_blocked'),
  ('admin_list_blocked_terms'),
  ('admin_add_blocked_term'),
  ('admin_remove_blocked_term'),
  ('admin_list_payments'),
  ('admin_mark_payment_refunded'),
  ('admin_find_guest'),
  ('admin_grant_scans'),
  ('admin_list_app_settings'),
  ('admin_set_app_setting'),
  -- Chat (migration chat); each acts only for the caller's own session and conversations.
  ('get_people'),
  ('get_requests'),
  ('send_chat_request'),
  ('respond_chat_request'),
  ('get_conversations'),
  ('get_messages'),
  ('send_message'),
  ('mark_seen'),
  -- Push (migration push): the caller's own browser subscription only.
  ('save_push_subscription'),
  ('delete_push_subscription'),
  -- Used by the Realtime RLS policies, which run as the caller; answers only
  -- whether the caller may use a topic.
  ('realtime_topic_allowed');

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
