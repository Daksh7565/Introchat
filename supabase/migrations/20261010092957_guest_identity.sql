-- =============================================================================
-- 0004 · guest identity: phone hashing, profiles and permanent handles, interest
-- tags, blocked words, bans, the OTP gatekeeper, and the before-user-created hook
--
-- Design references: ARCHITECTURE_AND_DATA_FLOW.md §2.2 (authentication),
-- §4.2 (login), §4.3 (onboarding), §6.3 (profiles, tags, bans, sms_log),
-- §11 (privacy). M2 plan, with the phase-1 finding that email sign-up cannot be
-- switched off without disabling email sign-in (tools/platform-checks/README.md).
--
-- Grants (pinned by supabase/tests/rls_test.sql):
--   authenticated          my_profile, accept_consent, update_profile, tag_suggestions, set_tags
--   service_role           sms_hook_check, sms_hook_finish   (the sms-hook Edge Function)
--   supabase_auth_admin    before_user_created_hook          (Supabase Auth itself)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Phone numbers: never stored by us in clear text, only as an HMAC
-- -----------------------------------------------------------------------------
-- The HMAC key is generated inside the database on first run and kept in Vault.
-- It never appears in a file, a log or this migration, and no person needs to
-- see it. Each project (dev, prod) gets its own key.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'phone_hash_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'phone_hash_key',
      'HMAC-SHA256 key for profiles.phone_hash and bans.phone_hash. Generated in the database; never export it.'
    );
  end if;
end
$$;

-- '+91 98xxxxxxxx', '9198xxxxxxxx', '98xxxxxxxx' → '9198xxxxxxxx'; anything that
-- is not an Indian mobile number → NULL. V1 accepts only +91 mobiles.
create function public.normalize_indian_mobile(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if digits ~ '^[6-9][0-9]{9}$' then
    digits := '91' || digits;
  end if;
  if digits !~ '^91[6-9][0-9]{9}$' then
    return null;
  end if;
  return digits;
end;
$$;
revoke all on function public.normalize_indian_mobile(text) from public, anon, authenticated;

create function public.phone_hash(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := public.normalize_indian_mobile(p_phone);
  v_key text;
begin
  if v_phone is null then
    raise exception 'PHONE_INVALID';
  end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'phone_hash_key';
  if v_key is null then
    -- Never fall back to an unkeyed hash: 10-digit numbers are trivially brute-forced.
    raise exception 'PHONE_HASH_KEY_MISSING';
  end if;
  return encode(extensions.hmac(v_phone, v_key, 'sha256'), 'hex');
end;
$$;
revoke all on function public.phone_hash(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- profiles (guests)
-- -----------------------------------------------------------------------------
-- One row per guest, created automatically on their first phone login. The
-- handle is permanent (decision 3). Other guests only ever see the handle and
-- tags: never the nickname, birth year, gender or anything about the phone.
create table public.profiles (
  id                 uuid        primary key references auth.users (id) on delete cascade,
  phone_hash         text        not null,
  handle             text        not null,
  nickname           text,
  birth_year         smallint,
  age_blocked        boolean     not null default false,
  gender             text,
  preferred_language text        not null default 'en',
  consent_at         timestamptz,
  consent_version    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint uq_profiles_phone_hash  unique (phone_hash),
  constraint uq_profiles_handle      unique (handle),
  constraint ck_profiles_handle      check (handle ~ '^[A-Z][a-z]{1,10}-[0-9]{4}$'),
  constraint ck_profiles_nickname    check (nickname is null or (char_length(nickname) between 1 and 30 and nickname = trim(nickname))),
  constraint ck_profiles_birth_year  check (birth_year is null or birth_year between 1900 and 2100),
  constraint ck_profiles_gender      check (gender is null or gender in ('male', 'female', 'other', 'prefer_not')),
  constraint ck_profiles_language    check (preferred_language in ('en', 'hi', 'gu')),
  constraint ck_profiles_consent     check ((consent_at is null) = (consent_version is null))
);
comment on table public.profiles is
  'Guests. id = their phone login. The phone number itself is only in auth.users (Supabase Auth); here only its HMAC.';
comment on column public.profiles.birth_year is
  'Set once (update_profile locks it). NULL = onboarding not finished.';
comment on column public.profiles.age_blocked is
  'true = gave a birth year under MIN_AGE. Cannot start sessions; lifted only by an admin (M7).';
comment on column public.profiles.nickname is 'Private: shown only to the guest themselves.';
comment on column public.profiles.gender is 'Private: used only in aggregate admin statistics.';
comment on column public.profiles.preferred_language is
  'Mirrors SUPPORTED_LANGUAGES in frontend/src/i18n/languages.ts; keep the two in step.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;

-- Permanent public handle: <Word>-<4 digits>. 200 neutral words × 10 000
-- numbers = 2 million handles. Not a secret, so random() is fine here.
create function public.generate_handle()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  words constant text[] := array[
    'Mango', 'Falcon', 'Lotus', 'Tiger', 'Pebble', 'Comet', 'Maple', 'River', 'Orbit', 'Cedar',
    'Coral', 'Breeze', 'Willow', 'Ember', 'Harbor', 'Meadow', 'Summit', 'Lagoon', 'Aurora', 'Canyon',
    'Delta', 'Echo', 'Fern', 'Glacier', 'Hazel', 'Iris', 'Jasmine', 'Kiwi', 'Lemon', 'Lilac',
    'Lynx', 'Marble', 'Nectar', 'Nova', 'Oasis', 'Olive', 'Opal', 'Otter', 'Panda', 'Papaya',
    'Parrot', 'Peach', 'Pepper', 'Pine', 'Plum', 'Prism', 'Quartz', 'Quill', 'Raven', 'Reef',
    'Ripple', 'Robin', 'Saffron', 'Sage', 'Sapphire', 'Sky', 'Sparrow', 'Spruce', 'Star', 'Stone',
    'Sunflower', 'Swan', 'Thunder', 'Tulip', 'Velvet', 'Violet', 'Wave', 'Whale', 'Zebra', 'Amber',
    'Anchor', 'Apricot', 'Arrow', 'Aspen', 'Badger', 'Bamboo', 'Banyan', 'Basil', 'Beacon', 'Birch',
    'Bison', 'Blossom', 'Bluebell', 'Bramble', 'Brook', 'Buffalo', 'Butter', 'Cactus', 'Camel', 'Candle',
    'Cardamom', 'Cashew', 'Cherry', 'Chestnut', 'Cinnamon', 'Clover', 'Cloud', 'Cobalt', 'Coconut', 'Copper',
    'Cosmos', 'Cotton', 'Crane', 'Crystal', 'Cypress', 'Daisy', 'Dawn', 'Dolphin', 'Dove', 'Dune',
    'Eagle', 'Elm', 'Emerald', 'Feather', 'Fig', 'Firefly', 'Flame', 'Flint', 'Forest', 'Fox',
    'Gazelle', 'Ginger', 'Glow', 'Grape', 'Guava', 'Gull', 'Harp', 'Hawk', 'Heron', 'Honey',
    'Horizon', 'Indigo', 'Ivy', 'Jade', 'Jaguar', 'Juniper', 'Kestrel', 'Koala', 'Lark', 'Lavender',
    'Leaf', 'Lime', 'Linden', 'Llama', 'Lumen', 'Lychee', 'Magnolia', 'Marigold', 'Meteor', 'Mint',
    'Monsoon', 'Moon', 'Moss', 'Myna', 'Neem', 'Nightingale', 'Nutmeg', 'Oak', 'Ocean', 'Onyx',
    'Orchid', 'Owl', 'Palm', 'Pearl', 'Peacock', 'Pelican', 'Penguin', 'Petal', 'Pixel', 'Plume',
    'Pollen', 'Pomelo', 'Poppy', 'Puffin', 'Quail', 'Rain', 'Rainbow', 'Rose', 'Ruby', 'Sandal',
    'Seal', 'Shell', 'Silver', 'Snow', 'Solar', 'Sonnet', 'Spark', 'Sprout', 'Squirrel', 'Sugar',
    'Sun', 'Teak', 'Tide', 'Topaz', 'Trail', 'Tulsi', 'Turtle', 'Valley', 'Walnut', 'Wren'
  ];
begin
  return words[1 + floor(random() * array_length(words, 1))::integer]
         || '-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
end;
$$;
revoke all on function public.generate_handle() from public, anon, authenticated;

-- Creates the profile the moment a phone account is created. Email accounts
-- (admins) get no profile. Retries a handle that is already taken.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_constraint text;
begin
  if new.phone is null or new.phone = '' then
    return new;
  end if;
  for attempt in 1 .. 10 loop
    begin
      insert into public.profiles (id, phone_hash, handle)
      values (new.id, public.phone_hash(new.phone), public.generate_handle());
      return new;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Only a handle collision is retried; anything else is a real error.
      if v_constraint <> 'uq_profiles_handle' then
        raise;
      end if;
    end;
  end loop;
  raise exception 'HANDLE_GENERATION_FAILED';
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- bans (needed now: a banned phone must get no OTP; ban screens come in M6/M7)
-- -----------------------------------------------------------------------------
create table public.bans (
  id          uuid        primary key default gen_random_uuid(),
  scope       text        not null,
  venue_id    uuid        references public.venues (id) on delete cascade,
  user_id     uuid,
  phone_hash  text,
  device_id   text,
  reason      text        not null,
  expires_at  timestamptz,
  created_by  uuid        references public.admins (user_id) on delete set null,
  lifted_at   timestamptz,
  lifted_by   uuid        references public.admins (user_id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ck_bans_scope      check (scope in ('platform', 'venue')),
  constraint ck_bans_venue      check ((scope = 'venue') = (venue_id is not null)),
  constraint ck_bans_identifier check (user_id is not null or phone_hash is not null or device_id is not null),
  constraint ck_bans_reason     check (length(trim(reason)) > 0),
  constraint ck_bans_lifted     check ((lifted_at is null) = (lifted_by is null))
);
comment on table public.bans is
  'Platform bans (whole app) and venue bans (kick cooldown). A ban matches by any of user_id, phone_hash, device_id.';
comment on column public.bans.user_id is
  'No FK on purpose: a ban must outlive the account it was made against (same for phone_hash).';
comment on column public.bans.expires_at is 'NULL = permanent.';
comment on column public.bans.created_by is 'Admin who banned. NULL = created by the system (or that admin was deleted).';

create index ix_bans_phone_hash on public.bans (phone_hash) where lifted_at is null and phone_hash is not null;
create index ix_bans_user_id    on public.bans (user_id)    where lifted_at is null and user_id is not null;
create index ix_bans_device_id  on public.bans (device_id)  where lifted_at is null and device_id is not null;

alter table public.bans enable row level security;
revoke all on table public.bans from anon, authenticated;

-- Whether any active ban matches. p_venue_id NULL = platform bans only.
create function public.active_ban_exists(
  p_user_id    uuid,
  p_phone_hash text,
  p_device_id  text,
  p_venue_id   uuid default null
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.bans b
    where b.lifted_at is null
      and (b.expires_at is null or b.expires_at > now())
      and (b.scope = 'platform' or (b.scope = 'venue' and b.venue_id = p_venue_id))
      and (b.user_id = p_user_id or b.phone_hash = p_phone_hash or b.device_id = p_device_id)
  );
$$;
revoke all on function public.active_ban_exists(uuid, text, text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Email sign-ups: refused unless an admin approved the address
-- -----------------------------------------------------------------------------
-- Email accounts exist only for admins. The provider cannot be switched off
-- (that also disables admin sign-in), so the hook below refuses every email
-- sign-up whose address has no unexpired approval here.
create table public.admin_email_approvals (
  email       text        primary key,
  approved_by uuid        references public.admins (user_id) on delete set null,
  expires_at  timestamptz not null default now() + interval '24 hours',
  created_at  timestamptz not null default now(),
  constraint ck_admin_email_approvals_email check (email = lower(email) and position('@' in email) > 1)
);
comment on table public.admin_email_approvals is
  'Emails an admin approved to become an account (for a new admin). Valid until expires_at.';
comment on column public.admin_email_approvals.approved_by is 'NULL = approved by hand in SQL (bootstrap) or that admin was deleted.';

alter table public.admin_email_approvals enable row level security;
revoke all on table public.admin_email_approvals from anon, authenticated;

-- Supabase Auth calls this before creating any user (Auth hook, "before user
-- created"). Returning {} allows; an {"error": {...}} object refuses, and the
-- message reaches the client as the error text.
create function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(nullif(trim(event -> 'user' ->> 'email'), ''));
  v_phone text := nullif(trim(event -> 'user' ->> 'phone'), '');
  v_phone_normalized text;
begin
  if v_phone is not null then
    v_phone_normalized := public.normalize_indian_mobile(v_phone);
    if v_phone_normalized is null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'PHONE_NOT_ALLOWED'));
    end if;
    if public.active_ban_exists(null, public.phone_hash(v_phone_normalized), null) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'BANNED'));
    end if;
    return '{}'::jsonb;
  end if;

  if v_email is not null then
    if exists (
      select 1 from public.admin_email_approvals a
      where a.email = v_email and a.expires_at > now()
    ) then
      return '{}'::jsonb;
    end if;
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_SIGNUP_DISABLED'));
  end if;

  -- Neither phone nor email (e.g. anonymous sign-in, which is disabled anyway).
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'SIGNUP_NOT_ALLOWED'));
end;
$$;
revoke all on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- OTP SMS: the gatekeeper used by the sms-hook Edge Function
-- -----------------------------------------------------------------------------
create table public.sms_log (
  id          bigint      generated always as identity primary key,
  phone_hash  text,
  status      text        not null,
  reason      text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  constraint ck_sms_log_status   check (status in ('pending', 'sent', 'failed', 'refused')),
  constraint ck_sms_log_finished check ((status = 'pending') = (finished_at is null))
);
comment on table public.sms_log is
  'One row per OTP SMS attempt. Never contains the code or the number. Kept 30 days (hourly cleanup, M3).';
comment on column public.sms_log.phone_hash is 'NULL when the number was not a valid Indian mobile (refused before hashing).';
comment on column public.sms_log.status is
  'pending = allowed, being sent (counts against limits); sent; failed (gateway error); refused (limits/ban/invalid).';

create index ix_sms_log_phone_created on public.sms_log (phone_hash, created_at desc) where status in ('pending', 'sent');
create index ix_sms_log_created on public.sms_log (created_at desc);

alter table public.sms_log enable row level security;
revoke all on table public.sms_log from anon, authenticated;

-- Decides whether an OTP may be sent to p_phone, and records the attempt.
-- Returns allowed = false with a refusal code instead of raising, so the
-- refusal itself is committed to sms_log.
create function public.sms_hook_check(p_phone text)
returns table (log_id bigint, allowed boolean, refusal text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone      text := public.normalize_indian_mobile(p_phone);
  v_hash       text;
  v_last_hour  integer;
  v_today      integer;
  v_cap        integer := public.setting_int('SMS_DAILY_CAP');
  v_alert_at   integer := public.setting_int('SMS_ALERT_AT');
  -- The SIM plan's day resets at midnight in India, not UTC.
  v_day_start  timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  -- One check at a time, so two requests at the cap cannot both slip through.
  perform pg_advisory_xact_lock(hashtext('introchat.sms_hook_check'));

  if v_phone is null then
    insert into public.sms_log (phone_hash, status, reason, finished_at)
    values (null, 'refused', 'PHONE_NOT_ALLOWED', now()) returning id into log_id;
    allowed := false; refusal := 'PHONE_NOT_ALLOWED';
    return next; return;
  end if;
  v_hash := public.phone_hash(v_phone);

  if public.active_ban_exists(null, v_hash, null) then
    refusal := 'BANNED';
  else
    select count(*) into v_last_hour from public.sms_log l
    where l.phone_hash = v_hash and l.status in ('pending', 'sent') and l.created_at > now() - interval '1 hour';
    select count(*) into v_today from public.sms_log l
    where l.status in ('pending', 'sent') and l.created_at >= v_day_start;
    if v_last_hour >= public.setting_int('OTP_PER_PHONE_PER_HOUR') then
      refusal := 'RATE_LIMITED';
    elsif v_today >= v_cap then
      refusal := 'SMS_DAILY_LIMIT';
    end if;
  end if;

  if refusal is not null then
    insert into public.sms_log (phone_hash, status, reason, finished_at)
    values (v_hash, 'refused', refusal, now()) returning id into log_id;
    if refusal = 'SMS_DAILY_LIMIT' and not exists (
      select 1 from public.audit_log a where a.action = 'sms.cap_reached' and a.created_at >= v_day_start
    ) then
      perform public.write_audit('system', null, 'sms.cap_reached', null, null, null, jsonb_build_object('cap', v_cap));
    end if;
    allowed := false;
    return next; return;
  end if;

  insert into public.sms_log (phone_hash, status) values (v_hash, 'pending') returning id into log_id;
  if v_today + 1 = v_alert_at then
    perform public.write_audit('system', null, 'sms.cap_alert', null, null, null,
      jsonb_build_object('sent_today', v_today + 1, 'cap', v_cap));
  end if;
  allowed := true;
  return next;
end;
$$;
revoke all on function public.sms_hook_check(text) from public, anon, authenticated;
grant execute on function public.sms_hook_check(text) to service_role;

-- Records the outcome of an allowed attempt after the gateway answered.
create function public.sms_hook_finish(p_log_id bigint, p_sent boolean, p_error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.sms_log
  set status = case when p_sent then 'sent' else 'failed' end,
      reason = case when p_sent then null else left(p_error, 200) end,
      finished_at = now()
  where id = p_log_id and status = 'pending';
  if not found then
    raise exception 'SMS_LOG_NOT_FOUND' using detail = p_log_id::text;
  end if;
end;
$$;
revoke all on function public.sms_hook_finish(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.sms_hook_finish(bigint, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- Interest tags
-- -----------------------------------------------------------------------------
-- "  Football  " → "football"; Hindi and Gujarati keep their letters and vowel
-- signs (only control characters and ASCII punctuation are refused; Postgres
-- character classes would wrongly reject Indic vowel signs). NULL = invalid.
create function public.normalize_tag(p_tag text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(regexp_replace(trim(normalize(coalesce(p_tag, ''), NFC)), '\s+', ' ', 'g'));
begin
  if char_length(v) not between 1 and 24 then
    return null;
  end if;
  if v ~ '[[:cntrl:]]' or v ~ '[!-/:-@\[-`{-~]' then
    return null;
  end if;
  return v;
end;
$$;
revoke all on function public.normalize_tag(text) from public, anon, authenticated;

create table public.tags (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  is_blocked boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tags_name unique (name),
  constraint ck_tags_normalized check (name = public.normalize_tag(name))
);
comment on table public.tags is
  'Normalised interest tags. Popularity is counted from user_tags when needed, not stored, so it cannot drift.';
comment on column public.tags.is_blocked is 'Set by an admin (M7) for a tag that slipped past blocked_terms.';

create trigger trg_tags_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

alter table public.tags enable row level security;
revoke all on table public.tags from anon, authenticated;

create table public.user_tags (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  tag_id     uuid        not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);
create index ix_user_tags_tag on public.user_tags (tag_id);

alter table public.user_tags enable row level security;
revoke all on table public.user_tags from anon, authenticated;

-- Words no tag may contain as a whole word (whole-word, so "class" is not
-- blocked by "ass"). Draft list: English plus common Hindi/Gujarati abuse in
-- Latin letters; to be reviewed by native speakers before the pilot, and
-- editable from the Admin Console (M7) without code.
create table public.blocked_terms (
  term       text        primary key,
  created_by uuid        references public.admins (user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ck_blocked_terms_normalized check (term = public.normalize_tag(term))
);
comment on column public.blocked_terms.created_by is 'NULL = part of the initial list in this migration.';

alter table public.blocked_terms enable row level security;
revoke all on table public.blocked_terms from anon, authenticated;

insert into public.blocked_terms (term) values
  ('fuck'), ('fucker'), ('fucking'), ('motherfucker'), ('shit'), ('bitch'), ('bastard'),
  ('asshole'), ('dick'), ('cock'), ('pussy'), ('cunt'), ('slut'), ('whore'), ('rape'),
  ('rapist'), ('porn'), ('nude'), ('nudes'), ('horny'), ('boobs'), ('penis'), ('vagina'),
  ('nigger'), ('nigga'), ('faggot'), ('retard'), ('hookup'), ('escort'),
  ('chutiya'), ('chutiye'), ('madarchod'), ('maderchod'), ('behenchod'), ('bhenchod'),
  ('bhosdi'), ('bhosdike'), ('bhosdina'), ('gaand'), ('gandu'), ('gaandu'), ('lund'),
  ('lauda'), ('lavda'), ('loda'), ('randi'), ('harami'), ('kamina'), ('chodu'), ('chod'),
  ('bhadwa'), ('bhadva'), ('chhinal'), ('mc'), ('bc');

-- Whether a normalised tag is blocked: an admin-blocked tag, or any blocked
-- term appearing as a whole word.
create function public.tag_is_blocked(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.tags t where t.name = p_name and t.is_blocked)
      or exists (
           select 1 from public.blocked_terms b
           where (' ' || p_name || ' ') like ('% ' || b.term || ' %')
         );
$$;
revoke all on function public.tag_is_blocked(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Consent version
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, value_type, venue_overridable, description) values
  ('CONSENT_VERSION', '"v1-draft"', 'text', false,
   'Version of the privacy notice guests must accept. Change it when the notice changes; guests are asked again.');

-- -----------------------------------------------------------------------------
-- Guest functions (authenticated)
-- -----------------------------------------------------------------------------
-- The caller's profile id, or NOT_A_GUEST for anyone without one (an admin's
-- email account, a deleted guest).
create function public.require_guest()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.profiles p where p.id = auth.uid();
  if v_id is null then
    raise exception 'NOT_A_GUEST';
  end if;
  return v_id;
end;
$$;
revoke all on function public.require_guest() from public, anon, authenticated;

create function public.my_profile()
returns table (
  handle             text,
  nickname           text,
  birth_year         smallint,
  gender             text,
  preferred_language text,
  consent_current    boolean,
  age_blocked        boolean,
  tags               text[],
  profile_complete   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.require_guest();
  v_consent text := public.setting('CONSENT_VERSION') #>> '{}';
begin
  return query
    select p.handle, p.nickname, p.birth_year, p.gender, p.preferred_language,
           p.consent_version is not distinct from v_consent,
           p.age_blocked,
           coalesce(array(select t.name from public.user_tags ut join public.tags t on t.id = ut.tag_id
                          where ut.user_id = p.id order by t.name), '{}'),
           -- Everything start_session (M3) will require.
           p.consent_version is not distinct from v_consent
             and p.birth_year is not null
             and not p.age_blocked
             and exists (select 1 from public.user_tags ut where ut.user_id = p.id)
    from public.profiles p
    where p.id = v_id;
end;
$$;

create function public.accept_consent(p_version text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.require_guest();
begin
  -- The app must show the current notice; an old copy is not consent to the new one.
  if p_version is distinct from (public.setting('CONSENT_VERSION') #>> '{}') then
    raise exception 'CONSENT_VERSION_OUTDATED';
  end if;
  update public.profiles set consent_at = now(), consent_version = p_version where id = v_id;
end;
$$;

-- Saves the profile. Returns 'ok', or 'under_age' when the birth year is under
-- MIN_AGE: that is recorded (age_blocked) rather than raised, because raising
-- would roll the record back and let the guest simply try another year.
create function public.update_profile(
  p_birth_year integer,
  p_nickname   text,
  p_gender     text,
  p_language   text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id       uuid := public.require_guest();
  v_profile  public.profiles%rowtype;
  v_year_now integer := extract(year from now() at time zone 'Asia/Kolkata')::integer;
  v_nickname text := nullif(trim(p_nickname), '');
begin
  select * into v_profile from public.profiles where id = v_id for update;
  if v_profile.age_blocked then
    raise exception 'AGE_BLOCKED';
  end if;
  if v_profile.consent_at is null then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if p_birth_year is null or p_birth_year not between 1900 and v_year_now then
    raise exception 'PROFILE_INVALID' using detail = '{"field":"birth_year"}';
  end if;
  -- Set once: a refused 2009 cannot become 2000 on the next try.
  if v_profile.birth_year is not null and v_profile.birth_year <> p_birth_year then
    raise exception 'BIRTH_YEAR_LOCKED';
  end if;
  if v_nickname is not null and (char_length(v_nickname) > 30 or v_nickname ~ '[[:cntrl:]]') then
    raise exception 'PROFILE_INVALID' using detail = '{"field":"nickname"}';
  end if;
  if p_gender is not null and p_gender not in ('male', 'female', 'other', 'prefer_not') then
    raise exception 'PROFILE_INVALID' using detail = '{"field":"gender"}';
  end if;
  if p_language not in ('en', 'hi', 'gu') then
    raise exception 'PROFILE_INVALID' using detail = '{"field":"language"}';
  end if;

  if v_year_now - p_birth_year < public.setting_int('MIN_AGE') then
    update public.profiles set birth_year = p_birth_year, age_blocked = true where id = v_id;
    return 'under_age';
  end if;

  update public.profiles
  set birth_year = p_birth_year, nickname = v_nickname, gender = p_gender, preferred_language = p_language
  where id = v_id;
  return 'ok';
end;
$$;

-- Popular tags to pick from, optionally filtered by what the guest is typing.
-- (M3 adds "popular at this venue right now" from the caller's live session.)
create function public.tag_suggestions(p_query text default '')
returns table (name text, users integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := public.normalize_tag(p_query);
begin
  perform public.require_guest();
  return query
    select t.name, count(ut.user_id)::integer
    from public.tags t
    left join public.user_tags ut on ut.tag_id = t.id
    where not t.is_blocked
      and (v_prefix is null or t.name like v_prefix || '%')
    group by t.name
    order by count(ut.user_id) desc, t.name
    limit 20;
end;
$$;

-- Replaces the guest's tags. Returns the saved, normalised tags.
create function public.set_tags(p_names text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid := public.require_guest();
  v_max   integer := public.setting_int('MAX_TAGS_PER_USER');
  v_names text[] := '{}';
  v_name  text;
  v_raw   text;
begin
  perform public.check_rate_limit('set_tags:' || v_id, 30, interval '1 hour');

  foreach v_raw in array coalesce(p_names, '{}') loop
    v_name := public.normalize_tag(v_raw);
    if v_name is null then
      raise exception 'TAG_INVALID' using detail = jsonb_build_object('tag', left(v_raw, 40))::text;
    end if;
    if not v_name = any (v_names) then
      v_names := v_names || v_name;
    end if;
  end loop;

  if cardinality(v_names) not between 1 and v_max then
    raise exception 'TAGS_COUNT_INVALID' using detail = jsonb_build_object('min', 1, 'max', v_max)::text;
  end if;
  foreach v_name in array v_names loop
    if public.tag_is_blocked(v_name) then
      raise exception 'TAG_NOT_ALLOWED' using detail = jsonb_build_object('tag', v_name)::text;
    end if;
  end loop;

  insert into public.tags (name) select unnest(v_names) on conflict (name) do nothing;
  delete from public.user_tags where user_id = v_id;
  insert into public.user_tags (user_id, tag_id)
  select v_id, t.id from public.tags t where t.name = any (v_names);
  return v_names;
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('my_profile', 'accept_consent', 'update_profile', 'tag_suggestions', 'set_tags')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
