-- =============================================================================
-- 0003 · venue API: what guests and admins may call for venues and tables
--
-- Every function here is SECURITY DEFINER with an empty search_path, checks its
-- caller itself, and is granted to exactly the roles listed beside it.
-- supabase/tests/rls_test.sql pins that list: a grant added here without being
-- added there fails the suite.
--
--   anon + authenticated : venue_public, location_check
--   authenticated (admin + MFA checked inside) : admin_*
--
-- Errors are codes (ARCHITECTURE §2.5, §10); the app translates them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers (no grants)
-- -----------------------------------------------------------------------------
create function public.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;
revoke all on function public.require_admin() from public, anon, authenticated;

-- Resolves a scanned QR (slug + token) to an open venue and an active table.
-- Shared by every guest entry point so all of them refuse exactly the same cases.
create function public.resolve_scan(p_slug text, p_qr_token text)
returns table (venue_id uuid, table_id uuid, table_label text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.venues%rowtype;
begin
  select * into v from public.venues where slug = p_slug and is_active;
  if not found then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  if v.closed_until is not null and v.closed_until > now() then
    raise exception 'VENUE_CLOSED' using detail = jsonb_build_object('until', v.closed_until)::text;
  end if;

  select v.id, t.id, t.label into venue_id, table_id, table_label
  from public.tables t
  where t.venue_id = v.id and t.qr_token = p_qr_token and t.is_active;
  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;
  return next;
end;
$$;
revoke all on function public.resolve_scan(text, text) from public, anon, authenticated;

-- Converts a CHECK / UNIQUE violation raised by a venue or table write into a
-- code the Admin Console can show next to the right field.
create function public.raise_admin_write_error(p_sqlstate text, p_constraint text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_constraint = 'uq_venues_slug' then
    raise exception 'SLUG_TAKEN';
  elsif p_constraint = 'uq_tables_venue_label' then
    raise exception 'TABLE_LABEL_TAKEN';
  elsif p_sqlstate in ('23514', '23502') then
    -- 23514 = a CHECK failed (constraint name says which field);
    -- 23502 = a required field was missing (constraint name is empty).
    raise exception 'VALIDATION_FAILED' using detail = jsonb_build_object('constraint', p_constraint)::text;
  end if;
  raise exception 'UNEXPECTED_WRITE_ERROR' using detail = jsonb_build_object('sqlstate', p_sqlstate, 'constraint', p_constraint)::text;
end;
$$;
revoke all on function public.raise_admin_write_error(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guest entry points (anon + authenticated)
-- -----------------------------------------------------------------------------
-- What the landing page shows after a scan. Never returns the venue's
-- coordinates or anything an admin configured beyond what the screen needs.
create function public.venue_public(p_slug text, p_qr_token text)
returns table (
  venue_name               text,
  venue_type               text,
  table_label              text,
  payments_enabled         boolean,
  scan_fee_enabled         boolean,
  subscription_enabled     boolean,
  scan_fee_paise           integer,
  subscription_price_paise integer,
  subscription_scans       integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  v_payments boolean;
begin
  select * into s from public.resolve_scan(p_slug, p_qr_token);
  v_payments := public.setting_bool('PAYMENTS_ENABLED', s.venue_id);

  select v.name, v.type into venue_name, venue_type from public.venues v where v.id = s.venue_id;
  table_label              := s.table_label;
  payments_enabled         := v_payments;
  -- The master switch overrides the others (ARCHITECTURE §2.3).
  scan_fee_enabled         := v_payments and public.setting_bool('SCAN_FEE_ENABLED', s.venue_id);
  subscription_enabled     := v_payments and public.setting_bool('SUBSCRIPTION_ENABLED', s.venue_id);
  scan_fee_paise           := public.setting_int('SCAN_FEE_PAISE', s.venue_id);
  subscription_price_paise := public.setting_int('SUBSCRIPTION_PRICE_PAISE');
  subscription_scans       := public.setting_int('SUBSCRIPTION_SCANS');
  return next;
end;
$$;
revoke all on function public.venue_public(text, text) from public, anon, authenticated;
grant execute on function public.venue_public(text, text) to anon, authenticated;

-- The landing page's location check. Only for the screen: start_session (M3)
-- evaluates the location again and is what actually decides. Returns only the
-- verdict, not the distance, so the venue's position cannot be triangulated.
create function public.location_check(
  p_slug        text,
  p_qr_token    text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision,
  p_device_id   text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s record;
begin
  -- device_id is a random id the browser keeps in localStorage. It only keys
  -- the rate limit here; it proves nothing about who is calling.
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'DEVICE_ID_INVALID';
  end if;
  perform public.check_rate_limit('location_check:' || p_device_id, 30, interval '1 minute');

  select * into s from public.resolve_scan(p_slug, p_qr_token);
  return (select e.state from public.evaluate_location(s.venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds) e);
end;
$$;
revoke all on function public.location_check(text, text, double precision, double precision, double precision, double precision, text)
  from public, anon, authenticated;
grant execute on function public.location_check(text, text, double precision, double precision, double precision, double precision, text)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Admin: venues
-- -----------------------------------------------------------------------------
create function public.admin_list_venues()
returns table (
  id           uuid,
  slug         text,
  name         text,
  type         text,
  city         text,
  is_active    boolean,
  closed_until timestamptz,
  table_count  integer,
  updated_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
    select v.id, v.slug, v.name, v.type, v.city, v.is_active, v.closed_until,
           (select count(*)::integer from public.tables t where t.venue_id = v.id and t.is_active),
           v.updated_at
    from public.venues v
    order by v.name;
end;
$$;

create function public.admin_get_venue(p_venue_id uuid)
returns table (
  id           uuid,
  slug         text,
  name         text,
  type         text,
  address      text,
  city         text,
  latitude     double precision,
  longitude    double precision,
  timezone     text,
  is_active    boolean,
  closed_until timestamptz,
  created_at   timestamptz,
  updated_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
    select v.id, v.slug, v.name, v.type, v.address, v.city, v.latitude::double precision,
           v.longitude::double precision, v.timezone, v.is_active, v.closed_until, v.created_at, v.updated_at
    from public.venues v
    where v.id = p_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND';
  end if;
end;
$$;

create function public.admin_create_venue(
  p_slug      text,
  p_name      text,
  p_type      text,
  p_address   text,
  p_city      text,
  p_latitude  double precision,
  p_longitude double precision,
  p_timezone  text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_state text;
  v_constraint text;
begin
  perform public.require_admin();
  begin
    insert into public.venues (slug, name, type, address, city, latitude, longitude, timezone)
    values (lower(trim(p_slug)), trim(p_name), p_type, nullif(trim(p_address), ''), nullif(trim(p_city), ''),
            round(p_latitude::numeric, 6), round(p_longitude::numeric, 6), p_timezone)
    returning id into v_id;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    perform public.raise_admin_write_error(v_state, v_constraint);
  end;
  perform public.write_audit('admin', auth.uid(), 'venue.create', 'venue', v_id, v_id,
    jsonb_build_object('slug', lower(trim(p_slug)), 'name', trim(p_name)));
  return v_id;
end;
$$;

create function public.admin_update_venue(
  p_venue_id uuid,
  p_slug     text,
  p_name     text,
  p_type     text,
  p_address  text,
  p_city     text,
  p_timezone text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_state text;
  v_constraint text;
begin
  perform public.require_admin();
  select to_jsonb(v) - 'created_at' - 'updated_at' into v_before
  from public.venues v where v.id = p_venue_id for update;
  if v_before is null then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  begin
    update public.venues
    set slug = lower(trim(p_slug)), name = trim(p_name), type = p_type,
        address = nullif(trim(p_address), ''), city = nullif(trim(p_city), ''), timezone = p_timezone
    where id = p_venue_id
    returning to_jsonb(venues) - 'created_at' - 'updated_at' into v_after;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    perform public.raise_admin_write_error(v_state, v_constraint);
  end;
  -- A slug change breaks every printed QR card of this venue; the audit row
  -- keeps the old slug so it can be traced.
  perform public.write_audit('admin', auth.uid(), 'venue.update', 'venue', p_venue_id, p_venue_id,
    jsonb_build_object('before', v_before, 'after', v_after));
end;
$$;

create function public.admin_set_venue_pin(p_venue_id uuid, p_latitude double precision, p_longitude double precision)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_state text;
  v_constraint text;
begin
  perform public.require_admin();
  select jsonb_build_object('latitude', v.latitude, 'longitude', v.longitude) into v_before
  from public.venues v where v.id = p_venue_id for update;
  if v_before is null then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  begin
    update public.venues
    set latitude = round(p_latitude::numeric, 6), longitude = round(p_longitude::numeric, 6)
    where id = p_venue_id;
  exception when check_violation or not_null_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    perform public.raise_admin_write_error(v_state, v_constraint);
  end;
  perform public.write_audit('admin', auth.uid(), 'venue.pin_set', 'venue', p_venue_id, p_venue_id,
    jsonb_build_object('before', v_before,
                       'after', jsonb_build_object('latitude', round(p_latitude::numeric, 6), 'longitude', round(p_longitude::numeric, 6))));
end;
$$;

-- Activation needs at least one active table: an active venue with no tables
-- would accept no scans and look broken to staff and guests alike.
create function public.admin_set_venue_active(p_venue_id uuid, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  if p_active and not exists (select 1 from public.tables t where t.venue_id = p_venue_id and t.is_active) then
    raise exception 'VENUE_HAS_NO_TABLES';
  end if;
  update public.venues set is_active = p_active where id = p_venue_id;
  perform public.write_audit('admin', auth.uid(),
    case when p_active then 'venue.activate' else 'venue.deactivate' end,
    'venue', p_venue_id, p_venue_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: per-venue setting overrides
-- -----------------------------------------------------------------------------
create function public.admin_list_venue_settings(p_venue_id uuid)
returns table (
  key            text,
  value_type     text,
  global_value   jsonb,
  override_value jsonb,
  min_value      numeric,
  max_value      numeric,
  description    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  return query
    select s.key, s.value_type, s.value, vs.value, s.min_value, s.max_value, s.description
    from public.app_settings s
    left join public.venue_settings vs on vs.key = s.key and vs.venue_id = p_venue_id
    where s.venue_overridable
    order by s.key;
end;
$$;

create function public.admin_set_venue_setting(p_venue_id uuid, p_key text, p_value jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform public.require_admin();
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  select vs.value into v_before from public.venue_settings vs where vs.venue_id = p_venue_id and vs.key = p_key;
  -- The validation trigger raises UNKNOWN_SETTING / SETTING_NOT_OVERRIDABLE /
  -- SETTING_VALUE_INVALID; they pass through unchanged.
  insert into public.venue_settings (venue_id, key, value, updated_by)
  values (p_venue_id, p_key, p_value, auth.uid())
  on conflict (venue_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform public.write_audit('admin', auth.uid(), 'venue_setting.set', 'venue', p_venue_id, p_venue_id,
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value));
end;
$$;

create function public.admin_clear_venue_setting(p_venue_id uuid, p_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform public.require_admin();
  delete from public.venue_settings vs
  where vs.venue_id = p_venue_id and vs.key = p_key
  returning vs.value into v_before;
  -- Clearing an override that does not exist is a no-op, and not audited.
  if v_before is not null then
    perform public.write_audit('admin', auth.uid(), 'venue_setting.clear', 'venue', p_venue_id, p_venue_id,
      jsonb_build_object('key', p_key, 'before', v_before));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: tables and QR tokens
-- -----------------------------------------------------------------------------
create function public.admin_list_tables(p_venue_id uuid)
returns table (id uuid, label text, qr_token text, is_active boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  return query
    select t.id, t.label, t.qr_token, t.is_active, t.created_at
    from public.tables t
    where t.venue_id = p_venue_id
    order by t.created_at, t.label;
end;
$$;

-- Creates several tables at once ("T01".."T20" is built by the Console).
create function public.admin_create_tables(p_venue_id uuid, p_labels text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_labels text[];
  v_count integer;
  v_state text;
  v_constraint text;
begin
  perform public.require_admin();
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'VENUE_NOT_FOUND';
  end if;
  select array_agg(trim(l)) into v_labels from unnest(p_labels) l;
  if v_labels is null or cardinality(v_labels) not between 1 and 200 then
    raise exception 'VALIDATION_FAILED' using detail = '{"constraint":"table_count"}';
  end if;
  begin
    insert into public.tables (venue_id, label)
    select p_venue_id, l from unnest(v_labels) l;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    perform public.raise_admin_write_error(v_state, v_constraint);
  end;
  -- Every label was inserted or the whole call failed above, so the count is
  -- the number of labels (ROW_COUNT is not reliable after leaving the block).
  v_count := cardinality(v_labels);
  perform public.write_audit('admin', auth.uid(), 'table.create', 'venue', p_venue_id, p_venue_id,
    jsonb_build_object('labels', to_jsonb(v_labels)));
  return v_count;
end;
$$;

create function public.admin_update_table(p_table_id uuid, p_label text, p_is_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  v_before jsonb;
  v_state text;
  v_constraint text;
begin
  perform public.require_admin();
  select t.venue_id, jsonb_build_object('label', t.label, 'is_active', t.is_active)
  into v_venue_id, v_before
  from public.tables t where t.id = p_table_id for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;
  begin
    update public.tables set label = trim(p_label), is_active = p_is_active where id = p_table_id;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    perform public.raise_admin_write_error(v_state, v_constraint);
  end;
  perform public.write_audit('admin', auth.uid(), 'table.update', 'table', p_table_id, v_venue_id,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object('label', trim(p_label), 'is_active', p_is_active)));
end;
$$;

-- Issues a new token for one table. The printed card for that table stops
-- working immediately (TABLE_NOT_FOUND); used when a card is lost or copied.
create function public.admin_regenerate_qr_token(p_table_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  v_token text;
begin
  perform public.require_admin();
  update public.tables set qr_token = public.generate_qr_token()
  where id = p_table_id
  returning venue_id, qr_token into v_venue_id, v_token;
  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;
  -- The new token is not written to the audit log: the log is readable by
  -- every admin for years, and a token there would be a working QR link.
  perform public.write_audit('admin', auth.uid(), 'table.qr_regenerate', 'table', p_table_id, v_venue_id);
  return v_token;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: on-site location test (the Console's live "Test" button)
-- -----------------------------------------------------------------------------
-- Same rule as guests get, but with the numbers behind the verdict so the admin
-- can see where the boundary falls while walking to the door. Not audited: it
-- changes nothing.
create function public.admin_test_location(
  p_venue_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision
)
returns table (
  state          text,
  distance_m     integer,
  radius_m       integer,
  max_accuracy_m integer,
  buffer_m       integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
    select e.state, e.distance_m,
           public.setting_int('GEOFENCE_RADIUS_M', p_venue_id),
           public.setting_int('MAX_ACCURACY_M', p_venue_id),
           public.setting_int('ACCURACY_BUFFER_M', p_venue_id)
    from public.evaluate_location(p_venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds) e;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants for the admin functions: callable by signed-in users, refused inside
-- (require_admin) unless the caller is an active admin who completed MFA.
-- -----------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
