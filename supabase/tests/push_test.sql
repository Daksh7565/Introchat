-- =============================================================================
-- Migration push: saving subscriptions, and which events queue a push for
-- whom. The HTTP call itself is pg_net's (queued here, sent after commit, so a
-- rolled-back test sends nothing). Rolled back at the end.
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
select plan(14);

insert into public.venues (id, slug, name, type, latitude, longitude, is_active)
values ('50000000-0000-4000-8000-000000000001', 'push-cafe', 'Push Cafe', 'cafe', 23.0225, 72.5714, true);
insert into auth.users (id, phone) values
  ('00000000-0000-4000-8000-0000000000f1', '919000000051'),
  ('00000000-0000-4000-8000-0000000000f2', '919000000052');
update public.profiles set preferred_language = 'gu' where id = '00000000-0000-4000-8000-0000000000f2';
insert into public.sessions (id, user_id, venue_id, kind, expires_at, location_state) values
  ('51000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '50000000-0000-4000-8000-000000000001', 'free', now() + interval '1 hour', 'inside'),
  ('51000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000f2', '50000000-0000-4000-8000-000000000001', 'free', now() + interval '1 hour', 'inside');

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || p_user), 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;
-- Pushes queued in this test, newest first.
create function pg_temp.queued() returns setof jsonb language sql as $$
  select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
  where q.url = 'https://push.test.invalid/push-send' order by q.id desc;
$$;

-- Subscriptions -------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('f2'); end $$;
select lives_ok($$select public.save_push_subscription('https://push.example.com/sub/1', 'BKeyKeyKey', 'authauth')$$,
  'a guest saves their browser''s subscription');
select throws_ok($$select public.save_push_subscription('http://push.example.com/sub/2', 'BKey', 'auth')$$,
  'P0001', 'VALIDATION_FAILED', 'a non-https endpoint is refused');
do $$ begin perform pg_temp.act_as('f1'); end $$;
select lives_ok($$select public.save_push_subscription('https://push.example.com/sub/9', 'BKey', 'auth')$$, 'another guest');
select lives_ok($$select public.save_push_subscription('https://push.example.com/sub/9', 'BKey2', 'auth2')$$,
  'saving the same browser again updates it');
select is((select count(*)::integer from public.push_subscriptions where endpoint = 'https://push.example.com/sub/9'), 1,
  'one row per browser');
do $$
begin
  for i in 10..15 loop
    perform public.save_push_subscription('https://push.example.com/sub/' || i, 'BKey', 'auth');
  end loop;
end $$;
select is((select count(*)::integer from public.push_subscriptions where user_id = '00000000-0000-4000-8000-0000000000f1'), 5,
  'a guest keeps at most 5 browsers');

-- Queueing ---------------------------------------------------------------------------
-- f1 and f2 chat; f2's app is not on screen (no heartbeat for a minute).
insert into public.conversations (id, user_low_id, user_high_id)
values ('52000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2');
insert into public.conversation_members (conversation_id, user_id) values
  ('52000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1'),
  ('52000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2');
update public.sessions set last_seen_at = now() - interval '1 minute' where user_id = '00000000-0000-4000-8000-0000000000f2';

select lives_ok($$select public.notify('user:00000000-0000-4000-8000-0000000000f2', 'chat.message',
  '{"conversation_id": "52000000-0000-4000-8000-000000000001", "body": "secret text"}')$$,
  'with push switched off, a message notice still works');
select is((select count(*)::integer from pg_temp.queued()), 0, 'and queues no push');

update public.app_settings set value = '"https://push.test.invalid/push-send"' where key = 'PUSH_FUNCTION_URL';
select lives_ok($$select public.notify('user:00000000-0000-4000-8000-0000000000f2', 'chat.message',
  '{"conversation_id": "52000000-0000-4000-8000-000000000001", "body": "secret text"}')$$, 'with push on');
select is((select q ->> 'kind' from pg_temp.queued() q limit 1), 'chat.message', 'a message to an away guest queues a push');
select is((select q ->> 'handle' from pg_temp.queued() q limit 1),
  (select handle from public.profiles where id = '00000000-0000-4000-8000-0000000000f1'),
  'naming the sender');
select ok((select q ->> 'language' = 'gu' and q::text not like '%secret text%' from pg_temp.queued() q limit 1),
  'in the recipient''s language, and never with the message text');

update public.sessions set last_seen_at = now() where user_id = '00000000-0000-4000-8000-0000000000f2';
select lives_ok($$select public.notify('user:00000000-0000-4000-8000-0000000000f2', 'chat.message',
  '{"conversation_id": "52000000-0000-4000-8000-000000000001"}')$$, 'a message while the app is on screen');
select is((select count(*)::integer from pg_temp.queued()), 1, 'queues no push (the chat shows it already)');

select * from finish();
rollback;
