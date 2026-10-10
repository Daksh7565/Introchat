-- =============================================================================
-- 0001 · extensions, access model, settings, admins, audit log, rate limits
--
-- The foundation every later migration relies on. Design references:
--   ARCHITECTURE_AND_DATA_FLOW.md §2 (cross-cutting rules), §6 (schema)
--   IMPLEMENTATION_PLAN.md §4 (every setting, its default and purpose)
--
-- Access model (the most important thing in this file):
--   Nothing in schema `public` is readable, writable or callable by the `anon`
--   or `authenticated` roles unless a migration grants it explicitly, function
--   by function. Every table has RLS on and no client policies. Guests and
--   admins reach data only through SECURITY DEFINER functions that check
--   auth.uid() themselves. supabase/tests/rls_test.sql enforces this for every
--   table and function, including ones added by later migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto: HMAC for phone hashes (M2). Already present on Supabase; declared so
-- the dependency is explicit.
create extension if not exists pgcrypto with schema extensions;
-- pg_cron: the timer jobs (warnings, expiry, away grace) from M3.
create extension if not exists pg_cron with schema pg_catalog;
-- pg_net: Postgres → Edge Function calls for push notifications (M4).
create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- Deny by default
-- -----------------------------------------------------------------------------
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase's
-- project defaults grant every new table, sequence and function in `public` to
-- anon and authenticated. Both are the opposite of this project's rule, so
-- they are removed for everything created by `postgres` (the role migrations
-- run as). The PUBLIC function default is global in Postgres and can only be
-- revoked globally, hence no `in schema` on that line.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Every object below also revokes explicitly. Default privileges only apply to
-- objects created by `postgres`; an explicit revoke holds whoever runs it.

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- admins
-- -----------------------------------------------------------------------------
-- One row per person on our team who may use the Admin Console. Admins sign in
-- with email + password + TOTP; the role lives here, never in a JWT claim the
-- client could influence.
create table public.admins (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  email       text        not null,
  is_active   boolean     not null default true,
  created_by  uuid        references public.admins (user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_admins_email unique (email),
  constraint ck_admins_email check (email = lower(email) and position('@' in email) > 1)
);
comment on table public.admins is
  'Our team members allowed into the Admin Console. Access also requires MFA (aal2); see is_admin().';
comment on column public.admins.created_by is
  'Admin who invited this one. NULL = the first admin (created by hand, not invited) or the inviter was deleted.';
comment on column public.admins.is_active is
  'false = access revoked. Kept rather than deleted so audit_log actor ids stay explainable.';

create trigger trg_admins_updated_at
  before update on public.admins
  for each row execute function public.set_updated_at();

alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

-- True only for an active admin whose session has completed MFA (aal2). A
-- stolen password alone (aal1) is not enough for any admin function.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1
       from public.admins a
       where a.user_id = auth.uid()
         and a.is_active
     );
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
-- Callable by signed-in users so the Admin Console can decide what to show.
-- It reveals nothing beyond "am I an admin".
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- app_settings
-- -----------------------------------------------------------------------------
-- Validates a setting value against its declared type and bounds. Shared by
-- app_settings now and venue_settings (M1), so one rule checks both.
-- Nested CASEs, not AND chains: SQL does not guarantee short-circuit order, and
-- casting a non-number to numeric must never be attempted.
create function public.setting_value_is_valid(
  p_value_type     text,
  p_value          jsonb,
  p_min_value      numeric,
  p_max_value      numeric,
  p_allowed_values text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_value_type
    when 'boolean' then
      jsonb_typeof(p_value) = 'boolean'
    when 'integer' then
      case
        when jsonb_typeof(p_value) <> 'number' then false
        else (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
             and (p_min_value is null or (p_value #>> '{}')::numeric >= p_min_value)
             and (p_max_value is null or (p_value #>> '{}')::numeric <= p_max_value)
      end
    when 'text' then
      case
        when jsonb_typeof(p_value) <> 'string' then false
        else p_allowed_values is null or (p_value #>> '{}') = any (p_allowed_values)
      end
    else false
  end;
$$;
revoke all on function public.setting_value_is_valid(text, jsonb, numeric, numeric, text[])
  from public, anon, authenticated;

-- One row per tunable value of the platform. Business rules read these through
-- setting() (M1); nothing may hard-code a price, duration or limit that lives
-- here. Secrets never go in this table.
create table public.app_settings (
  key               text        primary key,
  value             jsonb       not null,
  value_type        text        not null,
  min_value         numeric,
  max_value         numeric,
  allowed_values    text[],
  venue_overridable boolean     not null,
  description       text        not null,
  updated_by        uuid        references public.admins (user_id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_app_settings_key
    check (key ~ '^[A-Z][A-Z0-9_]*$'),
  constraint ck_app_settings_value_type
    check (value_type in ('boolean', 'integer', 'text')),
  constraint ck_app_settings_bounds_integer_only
    check (value_type = 'integer' or (min_value is null and max_value is null)),
  constraint ck_app_settings_bounds_order
    check (min_value is null or max_value is null or min_value <= max_value),
  constraint ck_app_settings_allowed_text_only
    check (value_type = 'text' or allowed_values is null),
  constraint ck_app_settings_value
    check (public.setting_value_is_valid(value_type, value, min_value, max_value, allowed_values)),
  constraint ck_app_settings_description
    check (length(trim(description)) > 0)
);
comment on table public.app_settings is
  'Every tunable value (prices, durations, limits, switches). Edited only from the Admin Console; every change is audit-logged.';
comment on column public.app_settings.min_value is 'Integer settings only. NULL = no lower bound.';
comment on column public.app_settings.max_value is 'Integer settings only. NULL = no upper bound.';
comment on column public.app_settings.allowed_values is 'Text settings only. NULL = any string.';
comment on column public.app_settings.venue_overridable is
  'true = venue_settings may override this key for one venue (M1).';
comment on column public.app_settings.updated_by is
  'Admin who last changed the value. NULL = value set by a migration (or that admin was deleted).';

create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;

-- Defaults. These are the agreed V1 values (IMPLEMENTATION_PLAN.md §4). Bounds
-- stop an admin typo (a 0 m radius, a ₹0 fee) from reaching guests; MIN_AGE can
-- never go below 18.
insert into public.app_settings
  (key, value, value_type, min_value, max_value, allowed_values, venue_overridable, description)
values
  -- Payment switches and prices
  ('PAYMENTS_ENABLED',              'false', 'boolean', null, null, null, true,  'Master payment switch. Off = every session is free, whatever the other switches say.'),
  ('SCAN_FEE_ENABLED',              'true',  'boolean', null, null, null, true,  'Charge the scan fee at entry (only when PAYMENTS_ENABLED is on).'),
  ('SUBSCRIPTION_ENABLED',          'true',  'boolean', null, null, null, true,  'Sell the subscription (only when PAYMENTS_ENABLED is on). Off = button shows "Coming soon".'),
  ('SCAN_FEE_PAISE',                '1900',  'integer', 100,  1000000, null, true,  'Scan fee in paise (1900 = ₹19).'),
  ('SCAN_SESSION_MINUTES',          '60',    'integer', 15,   480,  null, true,  'Minutes bought by one scan fee.'),
  ('CONTINUE_FEE_PAISE',            '1900',  'integer', 100,  1000000, null, true,  'Price in paise to continue without rescanning.'),
  ('CONTINUE_MINUTES',              '60',    'integer', 15,   480,  null, true,  'Minutes added by one paid continue.'),
  ('SUBSCRIPTION_PRICE_PAISE',      '40000', 'integer', 100,  10000000, null, false, 'Subscription price in paise (40000 = ₹400).'),
  ('SUBSCRIPTION_SCANS',            '25',    'integer', 1,    1000, null, false, 'Scan credits added by one subscription purchase.'),
  ('SUBSCRIPTION_SESSION_MINUTES',  '120',   'integer', 15,   720,  null, false, 'Minutes of one block paid with a scan credit.'),
  ('FREE_SESSION_MINUTES',          '60',    'integer', 1,    720,  null, true,  'Block length when payments are off. Minimum 1 so timer flows can be tested quickly on dev.'),
  -- Session timing
  ('WARNING_BEFORE_MINUTES',        '15',    'integer', 1,    60,   null, true,  'Minutes before the end of a block when the warning is sent.'),
  ('FINAL_PROMPT_SECONDS',          '120',   'integer', 30,   600,  null, false, 'How long the final "time is up" popup stays before the session ends.'),
  ('PAYMENT_GRACE_SECONDS',         '300',   'integer', 60,   1800, null, false, 'Extra final-prompt time while a payment is in progress, once per block.'),
  ('UNUSED_FEE_VALID_MINUTES',      '30',    'integer', 5,    1440, null, false, 'How long a paid but unused scan fee can still start a session at the same venue.'),
  -- Presence and location
  ('HEARTBEAT_INTERVAL_SECONDS',    '30',    'integer', 10,   120,  null, false, 'How often the app sends a heartbeat while visible.'),
  ('LOCATION_INTERVAL_SECONDS',     '120',   'integer', 30,   600,  null, false, 'How often the app takes a fresh GPS reading while visible.'),
  ('OFFLINE_AFTER_SECONDS',         '90',    'integer', 30,   600,  null, false, 'No heartbeat for this long = shown as Offline.'),
  ('AWAY_GRACE_SECONDS',            '180',   'integer', 60,   900,  null, true,  'Outside the venue for this long = session ends (left_venue).'),
  ('GEOFENCE_RADIUS_M',             '40',    'integer', 25,   300,  null, true,  'Venue radius in metres around its pin.'),
  ('MAX_ACCURACY_M',                '60',    'integer', 10,   500,  null, true,  'Readings less precise than this many metres count as unknown.'),
  ('ACCURACY_BUFFER_M',             '15',    'integer', 0,    100,  null, true,  'Edge tolerance in metres added to the radius for inside checks.'),
  ('MAX_LOCATION_AGE_SECONDS',      '120',   'integer', 10,   600,  null, false, 'Readings older than this are ignored.'),
  ('MAX_SPEED_MPS',                 '50',    'integer', 5,    500,  null, false, 'Speed between two readings above this (m/s) is flagged as possible GPS spoofing.'),
  -- Profile and chat
  ('MIN_AGE',                       '18',    'integer', 18,   100,  null, false, 'Minimum age to use the app. Cannot be set below 18.'),
  ('MAX_TAGS_PER_USER',             '5',     'integer', 1,    20,   null, false, 'Maximum interest tags per guest.'),
  ('CHAT_REQUEST_EXPIRY_MINUTES',   '10',    'integer', 1,    120,  null, false, 'Unanswered chat requests expire after this many minutes.'),
  ('MAX_PENDING_OUTGOING_REQUESTS', '5',     'integer', 1,    50,   null, false, 'Maximum unanswered chat requests one guest can have open.'),
  -- Safety
  ('KICK_COOLDOWN_HOURS',           '12',    'integer', 1,    720,  null, false, 'Hours a kicked guest cannot re-enter that venue.'),
  ('REPORT_EVIDENCE_ENABLED',       'true',  'boolean', null, null, null, false, 'Copy recent messages into a report as evidence.'),
  ('REPORT_EVIDENCE_MESSAGES',      '50',    'integer', 1,    500,  null, false, 'How many recent messages a report copies.'),
  ('REPORT_EVIDENCE_RETENTION_DAYS','30',    'integer', 1,    365,  null, false, 'Days report evidence is kept before it is erased.'),
  -- OTP SMS
  ('SMS_PROVIDER',                  '"phone_gateway"', 'text', null, null, array['phone_gateway', 'twilio'], false, 'Who delivers OTP SMS: the SIM gateway phone (V1) or Twilio (later).'),
  ('SMS_DAILY_CAP',                 '90',    'integer', 1,    100000, null, false, 'Maximum OTP SMS per day. Keep below the SIM plan''s daily limit (≈100).'),
  ('SMS_ALERT_AT',                  '70',    'integer', 1,    100000, null, false, 'Alert admins when this many OTP SMS have been sent today.'),
  ('OTP_PER_PHONE_PER_HOUR',        '5',     'integer', 1,    20,   null, false, 'Maximum OTP requests per phone number per hour.');

-- -----------------------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------------------
-- Append-only record of every admin action and every sensitive system action
-- (kicks, bans, setting changes, refunds). actor_id and target_id are
-- deliberately not foreign keys: an audit row must outlive the admin, guest or
-- object it describes.
create table public.audit_log (
  id          bigint      generated always as identity primary key,
  actor_type  text        not null,
  actor_id    uuid,
  action      text        not null,
  target_type text,
  target_id   uuid,
  venue_id    uuid,
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint ck_audit_log_actor_type check (actor_type in ('admin', 'guest', 'system')),
  constraint ck_audit_log_actor_id   check ((actor_type = 'system') = (actor_id is null)),
  constraint ck_audit_log_action     check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  constraint ck_audit_log_target     check ((target_type is null) = (target_id is null)),
  constraint ck_audit_log_meta       check (jsonb_typeof(meta) = 'object')
);
comment on table public.audit_log is
  'Append-only. Rows cannot be updated; they can be deleted only after the 2-year retention (ARCHITECTURE §11).';
comment on column public.audit_log.actor_id is
  'admins.user_id or profiles.id depending on actor_type. NULL exactly when actor_type = system. No FK by design.';
comment on column public.audit_log.venue_id is
  'Venue the action concerns, if any. FK to venues is added in the venues migration (0002).';
comment on column public.audit_log.action is 'Dotted lower-case verb, e.g. setting.update, guest.kick, ban.create.';

create index ix_audit_log_created       on public.audit_log (created_at desc);
create index ix_audit_log_venue_created on public.audit_log (venue_id, created_at desc) where venue_id is not null;
create index ix_audit_log_actor_created on public.audit_log (actor_id, created_at desc) where actor_id is not null;

create function public.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'AUDIT_LOG_IMMUTABLE' using detail = 'audit_log rows cannot be updated';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'AUDIT_LOG_IMMUTABLE' using detail = 'audit_log cannot be truncated';
  end if;
  -- DELETE: only the retention purge, i.e. rows past the 2-year retention.
  if old.created_at > now() - interval '2 years' then
    raise exception 'AUDIT_LOG_IMMUTABLE' using detail = 'audit_log rows are kept for 2 years';
  end if;
  return old;
end;
$$;
revoke all on function public.audit_log_guard() from public, anon, authenticated;

create trigger trg_audit_log_guard_rows
  before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();
create trigger trg_audit_log_guard_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_guard();

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;

-- Internal helper for later functions. Not callable by clients.
create function public.write_audit(
  p_actor_type  text,
  p_actor_id    uuid,
  p_action      text,
  p_target_type text  default null,
  p_target_id   uuid  default null,
  p_venue_id    uuid  default null,
  p_meta        jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, venue_id, meta)
  values (p_actor_type, p_actor_id, p_action, p_target_type, p_target_id, p_venue_id, p_meta);
$$;
revoke all on function public.write_audit(text, uuid, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- rate_limits
-- -----------------------------------------------------------------------------
-- Fixed-window counters (ARCHITECTURE §2.6). One row per key per window; the
-- hourly cleanup job (M3) deletes windows older than a day.
create table public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null,
  created_at   timestamptz not null default now(),
  primary key (key, window_start),
  constraint ck_rate_limits_key   check (length(key) between 1 and 200),
  constraint ck_rate_limits_count check (count > 0)
);
comment on table public.rate_limits is
  'Fixed-window request counters, e.g. key = heartbeat:<session_id>. Maintained only by check_rate_limit().';

create index ix_rate_limits_window_start on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- Counts one call against p_key and raises RATE_LIMITED (detail: retry_after in
-- seconds) when the window's limit is exceeded. Raising rolls back the caller's
-- transaction including this increment, so a blocked caller does not push the
-- counter further and is let through again as soon as the window turns.
-- Internal helper for later functions. Not callable by clients.
create function public.check_rate_limit(p_key text, p_limit integer, p_window interval)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_window_seconds numeric := extract(epoch from p_window);
  v_window_start   timestamptz;
  v_count          integer;
begin
  if p_limit is null or p_limit < 1 or v_window_seconds is null or v_window_seconds < 1 then
    raise exception 'INVALID_RATE_LIMIT'
      using detail = format('limit=%s window=%s', p_limit, p_window);
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  if v_count > p_limit then
    raise exception 'RATE_LIMITED'
      using detail = jsonb_build_object(
        'retry_after', ceil(extract(epoch from (v_window_start + p_window - now())))::integer
      )::text;
  end if;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, interval)
  from public, anon, authenticated;
