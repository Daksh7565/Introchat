-- =============================================================================
-- 0002 · venues, per-venue settings, tables, setting lookup, location rule
--
-- Design references: ARCHITECTURE_AND_DATA_FLOW.md §2.3 (settings resolution),
-- §3 (location check), §6.3 (venues, venue_settings, tables).
--
-- Access model unchanged from 0001: RLS on, no client policies, no grants.
-- Guest and admin entry points arrive in 0003 as SECURITY DEFINER functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- venues
-- -----------------------------------------------------------------------------
-- One row per partner restaurant or café. A venue is created inactive and only
-- accepts scans once an admin activates it (0003 requires at least one active
-- table first), so a half-configured venue can never be reached by a guest.
create table public.venues (
  id           uuid         primary key default gen_random_uuid(),
  slug         text         not null,
  name         text         not null,
  type         text         not null,
  address      text,
  city         text,
  latitude     numeric(9,6) not null,
  longitude    numeric(9,6) not null,
  timezone     text         not null default 'Asia/Kolkata',
  closed_until timestamptz,
  is_active    boolean      not null default false,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  constraint uq_venues_slug    unique (slug),
  -- 3–40 chars, lower-case letters/digits/hyphens, no leading or trailing hyphen.
  -- The slug is printed inside every QR URL of this venue.
  constraint ck_venues_slug    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint ck_venues_name    check (length(trim(name)) between 1 and 80),
  constraint ck_venues_type    check (type in ('restaurant', 'cafe')),
  constraint ck_venues_address check (address is null or length(address) <= 200),
  constraint ck_venues_city    check (city is null or length(city) <= 80),
  -- V1 venues are in India. Catches a swapped lat/lng or a typo that would put
  -- the pin in the sea and make every guest "outside".
  constraint ck_venues_in_india check (latitude between 6 and 38 and longitude between 68 and 98)
);
comment on table public.venues is
  'Partner restaurants and cafés. Created inactive; guests can scan only after activation.';
comment on column public.venues.closed_until is
  'Set by "close for today" (M7). NULL = open. While in the future, scans are refused (VENUE_CLOSED).';
comment on column public.venues.latitude is
  'Pin of the venue. Never returned to guests; only admin functions read it.';

create function public.venues_validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Stats and "close for today" compute local days in this zone (ARCHITECTURE
  -- §2.4); an unknown zone name would make those fail later, so reject it now.
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'INVALID_TIMEZONE' using detail = new.timezone;
  end if;
  return new;
end;
$$;
revoke all on function public.venues_validate_timezone() from public, anon, authenticated;

create trigger trg_venues_validate_timezone
  before insert or update of timezone on public.venues
  for each row execute function public.venues_validate_timezone();

create trigger trg_venues_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

alter table public.venues enable row level security;
revoke all on table public.venues from anon, authenticated;

-- audit_log rows can now point at a venue. SET NULL, never cascade: an audit
-- row must outlive what it describes (0001), and venues are deactivated, not
-- deleted, in normal operation.
alter table public.audit_log
  add constraint fk_audit_log_venue foreign key (venue_id) references public.venues (id) on delete set null;

-- -----------------------------------------------------------------------------
-- venue_settings
-- -----------------------------------------------------------------------------
-- One row per setting a venue overrides. The key is a real foreign key to
-- app_settings, so only existing settings can be overridden; RESTRICT means a
-- setting cannot be removed while a venue still overrides it.
create table public.venue_settings (
  venue_id   uuid        not null references public.venues (id) on delete cascade,
  key        text        not null references public.app_settings (key),
  value      jsonb       not null,
  updated_by uuid        references public.admins (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (venue_id, key)
);
comment on table public.venue_settings is
  'Per-venue overrides of app_settings. Only keys with venue_overridable = true; value checked against the key''s type and bounds.';
comment on column public.venue_settings.updated_by is
  'Admin who set the override. NULL = set by a migration (or that admin was deleted).';

create index ix_venue_settings_key on public.venue_settings (key);

-- Validates an override against its global definition. A trigger (not a CHECK)
-- because the rule lives in another table's row.
-- Note for M7: when an admin changes a setting's bounds, existing overrides must
-- be re-checked in the same transaction; this trigger only guards writes here.
create function public.venue_settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s public.app_settings%rowtype;
begin
  select * into s from public.app_settings where key = new.key;
  -- The FK guarantees the key exists by the time the row is stored; checked
  -- here too because BEFORE triggers run before FK checks.
  if not found then
    raise exception 'UNKNOWN_SETTING' using detail = new.key;
  end if;
  if not s.venue_overridable then
    raise exception 'SETTING_NOT_OVERRIDABLE' using detail = new.key;
  end if;
  if not public.setting_value_is_valid(s.value_type, new.value, s.min_value, s.max_value, s.allowed_values) then
    raise exception 'SETTING_VALUE_INVALID'
      using detail = jsonb_build_object(
        'key', new.key, 'value_type', s.value_type, 'min', s.min_value, 'max', s.max_value
      )::text;
  end if;
  return new;
end;
$$;
revoke all on function public.venue_settings_validate() from public, anon, authenticated;

create trigger trg_venue_settings_validate
  before insert or update on public.venue_settings
  for each row execute function public.venue_settings_validate();

create trigger trg_venue_settings_updated_at
  before update on public.venue_settings
  for each row execute function public.set_updated_at();

alter table public.venue_settings enable row level security;
revoke all on table public.venue_settings from anon, authenticated;

-- -----------------------------------------------------------------------------
-- tables (physical tables, each with its own QR card)
-- -----------------------------------------------------------------------------
-- 16 characters from [A-Za-z0-9] (~95 bits): QR links cannot be guessed or
-- enumerated (/v/<slug>/t/T07 could be). Rejection sampling keeps every
-- character equally likely (bytes ≥ 248 are discarded; 248 = 4 × 62).
create function public.generate_qr_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  token text := '';
  b integer;
  i integer;
  bytes bytea;
begin
  while length(token) < 16 loop
    bytes := extensions.gen_random_bytes(32);
    for i in 0 .. 31 loop
      b := get_byte(bytes, i);
      if b < 248 and length(token) < 16 then
        token := token || substr(alphabet, (b % 62) + 1, 1);
      end if;
    end loop;
  end loop;
  return token;
end;
$$;
revoke all on function public.generate_qr_token() from public, anon, authenticated;

create table public.tables (
  id         uuid        primary key default gen_random_uuid(),
  venue_id   uuid        not null references public.venues (id) on delete cascade,
  label      text        not null,
  qr_token   text        not null default public.generate_qr_token(),
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tables_qr_token    unique (qr_token),
  constraint uq_tables_venue_label unique (venue_id, label),
  constraint ck_tables_label       check (length(trim(label)) between 1 and 40 and label = trim(label)),
  constraint ck_tables_qr_token    check (qr_token ~ '^[A-Za-z0-9]{16}$')
);
comment on table public.tables is
  'Physical tables. Each QR card encodes /v/<venue slug>/t/<qr_token>. Regenerating the token invalidates the printed card.';
comment on column public.tables.is_active is
  'false = card no longer accepted (TABLE_NOT_FOUND). Tables are deactivated, not deleted, once sessions reference them (M3).';

create index ix_tables_venue on public.tables (venue_id);

create trigger trg_tables_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();

alter table public.tables enable row level security;
revoke all on table public.tables from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Setting lookup: venue override ?? global value (ARCHITECTURE §2.3)
-- -----------------------------------------------------------------------------
-- Every business rule reads prices, durations and limits through these, never
-- from literals. Unknown keys and wrong types fail loudly: a typo in a key name
-- must not silently fall back to some default.
create function public.setting(p_key text, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_venue_id is not null then
    select vs.value into v
    from public.venue_settings vs
    where vs.venue_id = p_venue_id and vs.key = p_key;
    if found then
      return v;
    end if;
  end if;
  select s.value into v from public.app_settings s where s.key = p_key;
  if not found then
    raise exception 'UNKNOWN_SETTING' using detail = p_key;
  end if;
  return v;
end;
$$;
revoke all on function public.setting(text, uuid) from public, anon, authenticated;

create function public.setting_int(p_key text, p_venue_id uuid default null)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb := public.setting(p_key, p_venue_id);
begin
  if jsonb_typeof(v) <> 'number' then
    raise exception 'SETTING_TYPE_MISMATCH' using detail = format('%s is not an integer setting', p_key);
  end if;
  return (v #>> '{}')::integer;
end;
$$;
revoke all on function public.setting_int(text, uuid) from public, anon, authenticated;

create function public.setting_bool(p_key text, p_venue_id uuid default null)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb := public.setting(p_key, p_venue_id);
begin
  if jsonb_typeof(v) <> 'boolean' then
    raise exception 'SETTING_TYPE_MISMATCH' using detail = format('%s is not a boolean setting', p_key);
  end if;
  return (v #>> '{}')::boolean;
end;
$$;
revoke all on function public.setting_bool(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Location rule (ARCHITECTURE §3.2)
-- -----------------------------------------------------------------------------
-- Great-circle distance in metres. Mean Earth radius 6 371 000 m, the same
-- constant the field-test page uses, so field results and the app agree.
create function public.haversine_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
         )));
$$;
revoke all on function public.haversine_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- Decides inside / outside / unknown for one phone reading at one venue.
--
-- p_age_seconds is the reading's age measured on the phone (phone "now" minus
-- the reading's timestamp). Both come from the phone's clock, so a phone whose
-- clock is wrong still reports a correct age; comparing the phone's timestamp
-- with the server clock would mark every reading from such a phone as stale.
--
--   d = distance from the pin, acc = reported accuracy
--   too old or acc > MAX_ACCURACY_M      → unknown
--   d <= RADIUS + min(acc, BUFFER)       → inside
--   d - acc > RADIUS                     → outside (outside even at best)
--   otherwise                            → unknown
create function public.evaluate_location(
  p_venue_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision
)
returns table (state text, distance_m integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_venue    record;
  v_radius   integer;
  v_max_acc  integer;
  v_buffer   integer;
  v_max_age  integer;
  v_distance double precision;
begin
  -- NaN and ±Infinity fail these range checks too (NaN sorts above every number in Postgres).
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
     or p_age_seconds is null or p_age_seconds not between -60 and 86400 then
    raise exception 'LOCATION_INVALID';
  end if;

  select v.latitude, v.longitude into v_venue from public.venues v where v.id = p_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND';
  end if;

  v_radius  := public.setting_int('GEOFENCE_RADIUS_M', p_venue_id);
  v_max_acc := public.setting_int('MAX_ACCURACY_M', p_venue_id);
  v_buffer  := public.setting_int('ACCURACY_BUFFER_M', p_venue_id);
  v_max_age := public.setting_int('MAX_LOCATION_AGE_SECONDS');

  v_distance := public.haversine_m(v_venue.latitude, v_venue.longitude, p_latitude, p_longitude);
  distance_m := round(v_distance)::integer;

  if p_age_seconds > v_max_age or p_accuracy_m > v_max_acc then
    state := 'unknown';
  elsif v_distance <= v_radius + least(p_accuracy_m, v_buffer) then
    state := 'inside';
  elsif v_distance - p_accuracy_m > v_radius then
    state := 'outside';
  else
    state := 'unknown';
  end if;
  return next;
end;
$$;
revoke all on function public.evaluate_location(uuid, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
