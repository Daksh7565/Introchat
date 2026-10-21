-- =============================================================================
-- Migration chat: the people list, chat requests, conversations and messages,
-- the clean-up when a visit ends, and who may listen on which live channel.
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
select plan(50);

insert into public.venues (id, slug, name, type, latitude, longitude, is_active) values
  ('30000000-0000-4000-8000-000000000001', 'chat-one', 'Chat One', 'cafe', 23.022500, 72.571400, true),
  ('30000000-0000-4000-8000-000000000002', 'chat-two', 'Chat Two', 'cafe', 23.030000, 72.580000, true);

-- e1, e2, e3, e6 at venue one; e4 at venue two; e5 has no session.
insert into auth.users (id, phone)
select ('00000000-0000-4000-8000-0000000000e' || n)::uuid, '91900000004' || n from generate_series(1, 6) n;
insert into public.tags (name) values ('music'), ('cricket') on conflict (name) do nothing;
insert into public.user_tags (user_id, tag_id)
select u::uuid, t.id from public.tags t, (values
  ('00000000-0000-4000-8000-0000000000e1', 'music'), ('00000000-0000-4000-8000-0000000000e1', 'cricket'),
  ('00000000-0000-4000-8000-0000000000e2', 'music'), ('00000000-0000-4000-8000-0000000000e2', 'cricket'),
  ('00000000-0000-4000-8000-0000000000e3', 'cricket')) v(u, n)
where t.name = v.n;
insert into public.sessions (id, user_id, venue_id, kind, expires_at, location_state, started_at)
select ('31000000-0000-4000-8000-00000000000' || n)::uuid, ('00000000-0000-4000-8000-0000000000e' || n)::uuid,
       case when n = 4 then '30000000-0000-4000-8000-000000000002' else '30000000-0000-4000-8000-000000000001' end::uuid,
       'free', now() + interval '1 hour', 'inside', now() - make_interval(mins => n)
from unnest(array[1, 2, 3, 4, 6]) n;

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || p_user), 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;
create function pg_temp.handle(p_user text) returns text language sql as $$
  select handle from public.profiles where id = ('00000000-0000-4000-8000-0000000000' || p_user)::uuid;
$$;
create function pg_temp.sess(p_n int) returns uuid language sql as $$
  select ('31000000-0000-4000-8000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.state_of(p_session int) returns text language sql as $$
  select p.chat_state from public.get_people() p where p.session_id = pg_temp.sess(p_session);
$$;

-- People ----------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('e1'); end $$;
select is((select count(*)::integer from public.get_people()), 3, 'a guest sees the 3 others at their venue, not the one elsewhere');
select is((select handle from public.get_people() limit 1), pg_temp.handle('e2'), 'the person sharing the most interests comes first');
select is((select shared_tags from public.get_people() where session_id = pg_temp.sess(2)), array['cricket', 'music'],
  'shared interests are listed');
update public.sessions set is_offline = true where id = pg_temp.sess(2);
select isnt((select handle from public.get_people() limit 1), pg_temp.handle('e2'), 'someone offline moves to the end');
update public.sessions set is_offline = false where id = pg_temp.sess(2);

do $$ begin perform pg_temp.act_as('e4'); end $$;
select is((select count(*)::integer from public.get_people()), 0, 'a guest at another venue sees nobody from this one');
do $$ begin perform pg_temp.act_as('e5'); end $$;
select throws_ok($$select * from public.get_people()$$, 'P0001', 'SESSION_NOT_ACTIVE', 'no session, no people list');

-- Requests ----------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('e1'); end $$;
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(4))$$, 'P0001', 'NOT_SAME_VENUE',
  'no request to someone at another venue');
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(1))$$, 'P0001', 'REQUEST_NOT_ALLOWED',
  'no request to yourself');
create temporary table req12 on commit drop as select * from public.send_chat_request(pg_temp.sess(2));
select isnt((select request_id from req12), null, 'a request is sent');
select ok(exists (select 1 from realtime.messages where topic = 'user:00000000-0000-4000-8000-0000000000e2'
                  and event = 'request.received'), 'the other person is told at once');
select is(pg_temp.state_of(2), 'request_sent', 'the sender sees "request sent"');
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(2))$$, 'P0001', 'REQUEST_EXISTS',
  'asking twice is refused');

do $$ begin perform pg_temp.act_as('e2'); end $$;
select is(pg_temp.state_of(1), 'request_received', 'the receiver sees "accept"');
select is((select request_id from public.get_people() where session_id = pg_temp.sess(1)), (select request_id from req12),
  'with the request to answer');
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(1))$$, 'P0001', 'REQUEST_EXISTS',
  'asking back while a request is waiting is refused (the app shows Accept)');
select is((select count(*)::integer from public.get_requests()), 1, 'the request is in the Requests tab');

do $$ begin perform pg_temp.act_as('e3'); end $$;
select throws_ok(format($$select * from public.respond_chat_request(%L, true)$$, (select request_id from req12)),
  'P0001', 'REQUEST_NOT_FOUND', 'nobody else can answer it');

do $$ begin perform pg_temp.act_as('e2'); end $$;
create temporary table conv12 on commit drop as
  select conversation_id from public.respond_chat_request((select request_id from req12), true);
select isnt((select conversation_id from conv12), null, 'accepting opens a conversation');
select is(pg_temp.state_of(1), 'chatting', 'both now see "chatting"');

do $$ begin perform pg_temp.act_as('e1'); end $$;
select is((select conversation_id from public.send_chat_request(pg_temp.sess(2))), (select conversation_id from conv12),
  '"say hi" to someone you are chatting with opens the same conversation');

-- Decline
select lives_ok($$select * from public.send_chat_request(pg_temp.sess(3))$$, 'a request to e3');
do $$ begin perform pg_temp.act_as('e3'); end $$;
select lives_ok($$select * from public.respond_chat_request((select request_id from public.get_requests() limit 1), false)$$,
  'e3 declines');
select throws_ok($$select * from public.send_chat_request(pg_temp.sess(1))$$, 'P0001', 'REQUEST_NOT_ALLOWED',
  'after a decline neither can ask again during these visits');
do $$ begin perform pg_temp.act_as('e1'); end $$;
select is(pg_temp.state_of(3), 'declined', 'the sender sees "not available"');

-- Expiry
do $$ begin perform pg_temp.act_as('e6'); end $$;
create temporary table req62 on commit drop as select * from public.send_chat_request(pg_temp.sess(2));
update public.chat_requests set expires_at = now() - interval '1 second' where id = (select request_id from req62);
select ok((public.tick() ->> 'requests_expired')::integer >= 1, 'the tick expires an unanswered request');
select is((select status from public.chat_requests where id = (select request_id from req62)), 'expired', 'marked expired');

-- Messages ---------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('e1'); end $$;
create temporary table msg1 on commit drop as
  select * from public.send_message((select conversation_id from conv12), 'Hi! 🎵 नमस्ते', '41000000-0000-4000-8000-000000000001');
select isnt((select message_id from msg1), null, 'a message is sent');
select is((select message_id from public.send_message((select conversation_id from conv12), 'Hi! 🎵 नमस्ते',
  '41000000-0000-4000-8000-000000000001')), (select message_id from msg1), 'a retried send returns the same message');
select is((select count(*)::integer from public.messages where conversation_id = (select conversation_id from conv12)), 1,
  'no duplicate is stored');
select throws_ok(format($$select * from public.send_message(%L, '   ', gen_random_uuid())$$, (select conversation_id from conv12)),
  'P0001', 'MESSAGE_INVALID', 'an empty message is refused');
select throws_ok(format($$select * from public.send_message(%L, repeat('a', 1001), gen_random_uuid())$$, (select conversation_id from conv12)),
  'P0001', 'MESSAGE_INVALID', 'a message over 1000 characters is refused');

do $$ begin perform pg_temp.act_as('e2'); end $$;
select is((select unread from public.get_conversations()), 1, 'the receiver has 1 unread');
select is((select partner_handle from public.get_conversations()), pg_temp.handle('e1'), 'shown with the sender''s handle');
select is((select body from public.get_messages((select conversation_id from conv12))), 'Hi! 🎵 नमस्ते',
  'emoji and Hindi arrive intact');
select lives_ok(format($$select public.mark_seen(%L, %s)$$, (select conversation_id from conv12), (select message_id from msg1)),
  'the receiver reads it');
select is((select unread from public.get_conversations()), 0, 'no longer unread');

do $$ begin perform pg_temp.act_as('e1'); end $$;
select is((select seen from public.get_messages((select conversation_id from conv12))), true, 'the sender sees it was seen');
select is((select count(*)::integer from public.get_messages((select conversation_id from conv12), null, (select message_id from msg1))),
  0, 'fetching after the last message returns nothing new');

do $$ begin perform pg_temp.act_as('e3'); end $$;
select throws_ok(format($$select * from public.get_messages(%L)$$, (select conversation_id from conv12)),
  'P0001', 'CONVERSATION_NOT_FOUND', 'nobody else can read the conversation');

-- Live channels -----------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('e2'); end $$;
select ok(public.realtime_topic_allowed('user:00000000-0000-4000-8000-0000000000e2', false), 'a guest listens on their own channel');
select ok(not public.realtime_topic_allowed('user:00000000-0000-4000-8000-0000000000e1', false), 'but never on someone else''s');
select ok(public.realtime_topic_allowed('venue:30000000-0000-4000-8000-000000000001', false)
          and not public.realtime_topic_allowed('venue:30000000-0000-4000-8000-000000000002', false),
  'a guest hears their own venue only');
select ok(public.realtime_topic_allowed('conv:' || (select conversation_id from conv12), true),
  'a member can send "typing" in their conversation');

-- Blocks (the button arrives in M6) -----------------------------------------------------
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e1');
do $$ begin perform pg_temp.act_as('e1'); end $$;
select is((select count(*)::integer from public.get_people() where session_id = pg_temp.sess(3)), 0,
  'a block hides the two from each other');

-- End of a visit -------------------------------------------------------------------------
do $$ begin perform pg_temp.act_as('e6'); end $$;
create temporary table req61 on commit drop as select * from public.send_chat_request(pg_temp.sess(1));
select lives_ok($$select public.end_session(pg_temp.sess(1), 'user_logout')$$, 'e1 leaves');
select is((select status from public.chat_requests where id = (select request_id from req61)), 'cancelled',
  'requests to someone who left are cancelled');

do $$ begin perform pg_temp.act_as('e2'); end $$;
select is((select can_send from public.get_conversations()), false, 'the other person still sees the chat, read-only');
select throws_ok(format($$select * from public.send_message(%L, 'still there?', gen_random_uuid())$$, (select conversation_id from conv12)),
  'P0001', 'CONVERSATION_READ_ONLY', 'and cannot write to someone who left');

select lives_ok($$select public.end_session(pg_temp.sess(2), 'expired')$$, 'e2''s visit ends too');
select is((select count(*)::integer from public.messages where conversation_id = (select conversation_id from conv12)), 0,
  'once nobody sees it, the conversation and its messages are deleted');

select * from finish();
rollback;
