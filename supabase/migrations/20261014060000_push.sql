-- =============================================================================
-- Migration push (M4 phase 4): web push notifications for guests whose app is
-- not on screen (ARCHITECTURE §4.14).
--
-- Path: notify() → queue_push() → pg_net POST (sent only after the change
-- commits) → Edge Function push-send → the browser's push service → the phone.
-- The text never contains a message body: "New message from Mango-4821".
--
-- Per project, after this migration (not secret, differs dev/prod):
--   update public.app_settings
--   set value = to_jsonb('https://<ref>.supabase.co/functions/v1/push-send'::text)
--   where key = 'PUSH_FUNCTION_URL';
-- Until then push is off and nothing is sent.
-- =============================================================================

create table public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  endpoint     text        not null,
  p256dh       text        not null,
  auth         text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_push_subscriptions_endpoint unique (endpoint),
  constraint ck_push_subscriptions_endpoint check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  constraint ck_push_subscriptions_keys     check (char_length(p256dh) between 1 and 200 and char_length(auth) between 1 and 100)
);
comment on table public.push_subscriptions is
  'One per browser that allowed notifications. Deleted when the push service says it is gone (404/410).';
create index ix_push_subscriptions_user on public.push_subscriptions (user_id);

create trigger trg_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- Shared secret between this database and push-send, generated here and kept
-- in Vault (like phone_hash_key): it never appears in a file or a log. The
-- function reads it once through push_send_secret() with the service role.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_send_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_send_secret',
      'Proves to the push-send Edge Function that a request came from this database.'
    );
  end if;
end
$$;

insert into public.app_settings (key, value, value_type, venue_overridable, description) values
  ('PUSH_FUNCTION_URL', '""', 'text', false,
   'Address of this project''s push-send Edge Function. Empty = push notifications off.');

-- -----------------------------------------------------------------------------
-- Guest functions
-- -----------------------------------------------------------------------------
-- Saves this browser's subscription for the signed-in guest. A browser that
-- changes account moves its subscription with it. At most 5 per guest (the
-- newest), so old phones stop being notified.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
begin
  perform public.check_rate_limit('push_subscription:' || v_user, 20, interval '1 hour');
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (v_user, p_endpoint, p_p256dh, p_auth)
    on conflict on constraint uq_push_subscriptions_endpoint do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  exception when check_violation or not_null_violation then
    raise exception 'VALIDATION_FAILED';
  end;
  delete from public.push_subscriptions x
  where x.user_id = v_user
    and x.id not in (select y.id from public.push_subscriptions y where y.user_id = v_user
                     order by y.updated_at desc limit 5);
end;
$$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_user;
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('save_push_subscription', 'delete_push_subscription')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- push-send's functions (service role only)
-- -----------------------------------------------------------------------------
create function public.push_send_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'push_send_secret';
$$;

create function public.push_targets(p_user_id uuid)
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s where s.user_id = p_user_id;
$$;

create function public.push_subscription_gone(p_endpoint text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('push_send_secret', 'push_targets', 'push_subscription_gone')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Queueing
-- -----------------------------------------------------------------------------
-- Pushes only to a guest whose app is not on screen: an open app sends a
-- heartbeat every HEARTBEAT_INTERVAL_SECONDS, so none for 1.5 intervals means
-- it is hidden or the phone is locked. (Waiting for "offline", 90 s, would
-- miss a message that arrives just after the phone is locked.) Every event
-- here concerns a live session, so a guest without one gets nothing.
-- Never raises: a push is a convenience and must not fail a chat message.
create function public.queue_push(p_user_id uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_url    text := public.setting('PUSH_FUNCTION_URL') #>> '{}';
  s        public.sessions%rowtype;
  v_handle text;
  v_secret text;
begin
  if coalesce(v_url, '') = ''
     or not exists (select 1 from public.push_subscriptions x where x.user_id = p_user_id) then
    return;
  end if;
  s := public.live_session_of(p_user_id);
  if s.id is null
     or s.last_seen_at > now() - make_interval(secs => public.setting_int('HEARTBEAT_INTERVAL_SECONDS') * 1.5) then
    return;
  end if;

  v_handle := case p_event
    when 'chat.message' then
      (select p.handle from public.profiles p
       where p.id = public.partner_of((p_payload ->> 'conversation_id')::uuid, p_user_id))
    when 'request.received' then
      (select p.handle from public.chat_requests r join public.profiles p on p.id = r.from_user_id
       where r.id = (p_payload ->> 'request_id')::uuid)
    when 'request.accepted' then
      (select p.handle from public.chat_requests r join public.profiles p on p.id = r.to_user_id
       where r.id = (p_payload ->> 'request_id')::uuid)
  end;
  select x.decrypted_secret into v_secret from vault.decrypted_secrets x where x.name = 'push_send_secret';

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'user_id', p_user_id,
      'kind', p_event,
      'handle', v_handle,
      'language', (select p.preferred_language from public.profiles p where p.id = p_user_id),
      'conversation_id', p_payload ->> 'conversation_id'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'queue_push failed: %', sqlerrm;
end;
$$;
revoke all on function public.queue_push(uuid, text, jsonb) from public, anon, authenticated;

-- notify() now also pushes the events a guest should hear about while away.
create or replace function public.notify(p_topic text, p_event text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
  if p_topic like 'user:%'
     and p_event in ('request.received', 'request.accepted', 'chat.message', 'session.warning', 'session.final_prompt') then
    perform public.queue_push(substr(p_topic, 6)::uuid, p_event, p_payload);
  end if;
end;
$$;
revoke all on function public.notify(text, text, jsonb) from public, anon, authenticated;
