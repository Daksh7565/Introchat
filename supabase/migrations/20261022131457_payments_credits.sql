-- =============================================================================
-- Migration payments_credits (M5): Razorpay payments, scan credits, paid and
-- subscription sessions, free resume, subscriber chat history, and the admin
-- side (payments list, refunds, granting scans, the global settings editor).
-- ARCHITECTURE §4.4, §4.5, §4.10, §4.11, §4.13, decisions 10–14.
--
-- Everything here is behind PAYMENTS_ENABLED (default false): with the switch
-- off, start_session and the timer behave exactly as before.
--
-- Entities:
--   payments        one row per checkout attempt (a Razorpay order); kept for
--                   accounting even when the guest's account is deleted
--   credit_ledger   one row per change to a guest's scan credits
--   profiles.scan_credits  cached ledger balance; only ledger_add() writes it
--                   (enforced by trigger), so the two can never disagree
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Scan credits
-- -----------------------------------------------------------------------------
alter table public.profiles add column scan_credits integer not null default 0;
alter table public.profiles add constraint ck_profiles_scan_credits check (scan_credits >= 0);
comment on column public.profiles.scan_credits is
  'Cached balance of credit_ledger for this guest. Written only by ledger_add() (trigger-enforced). 0 = not a subscriber.';

-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        references public.profiles (id) on delete set null,
  venue_id            uuid        not null references public.venues (id) on delete restrict,
  session_id          uuid        references public.sessions (id) on delete set null,
  purpose             text        not null,
  amount_paise        integer     not null,
  currency            text        not null default 'INR',
  provider            text        not null default 'razorpay',
  provider_order_id   text,
  provider_payment_id text,
  status              text        not null default 'created',
  paid_at             timestamptz,
  failed_at           timestamptz,
  refunded_at         timestamptz,
  refunded_by         uuid        references public.admins (user_id) on delete set null,
  refund_note         text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ck_payments_purpose  check (purpose in ('scan_fee', 'continue', 'subscription')),
  constraint ck_payments_amount   check (amount_paise > 0),
  constraint ck_payments_currency check (currency = 'INR'),
  constraint ck_payments_provider check (provider = 'razorpay'),
  constraint ck_payments_status   check (status in ('created', 'paid', 'failed', 'refunded')),
  constraint ck_payments_paid     check ((status in ('paid', 'refunded')) = (paid_at is not null)),
  constraint ck_payments_failed   check ((status = 'failed') = (failed_at is not null)),
  constraint ck_payments_refunded check ((status = 'refunded') = (refunded_at is not null)),
  constraint ck_payments_note     check (refund_note is null or char_length(refund_note) <= 500),
  constraint ck_payments_raw      check (raw is null or jsonb_typeof(raw) = 'object'),
  constraint uq_payments_provider_order   unique (provider_order_id),
  constraint uq_payments_provider_payment unique (provider_payment_id)
);
comment on table public.payments is
  'One row per checkout attempt (one Razorpay order). Amounts are integer paise, taken from settings when created, never from the phone.';
comment on column public.payments.user_id is
  'NULL only after the guest deleted their account: payment records are kept for accounting and refunds.';
comment on column public.payments.session_id is
  'The session this payment paid for (entry, continue, or the upgraded session). NULL = not used yet (an unused fee) or a subscription bought outside a session.';
comment on column public.payments.raw is
  'Minimal provider facts from the last verify / webhook (ids, method, status). Never the payer''s contact details.';

create index ix_payments_user_unused on public.payments (user_id, venue_id, paid_at)
  where status = 'paid' and session_id is null and purpose in ('scan_fee', 'continue');
create index ix_payments_stale         on public.payments (created_at) where status = 'created';
create index ix_payments_venue_created on public.payments (venue_id, created_at desc);
create index ix_payments_created       on public.payments (created_at desc);
create index ix_payments_user          on public.payments (user_id);
create index ix_payments_session       on public.payments (session_id);
create index ix_payments_refunded_by   on public.payments (refunded_by);

create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Credit ledger
-- -----------------------------------------------------------------------------
create table public.credit_ledger (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  delta      integer     not null,
  reason     text        not null,
  payment_id uuid        references public.payments (id) on delete restrict,
  session_id uuid        references public.sessions (id) on delete set null,
  admin_id   uuid        references public.admins (user_id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  constraint ck_credit_ledger_delta  check (delta <> 0),
  constraint ck_credit_ledger_reason check (reason in
    ('purchase', 'session_start', 'session_upgrade', 'continue', 'admin_grant', 'refund_adjust')),
  constraint ck_credit_ledger_note   check (note is null or char_length(note) <= 500)
);
comment on table public.credit_ledger is
  'Every change to a guest''s scan credits. sum(delta) per guest = profiles.scan_credits (both written by ledger_add only).';
comment on column public.credit_ledger.admin_id is 'Who granted or adjusted it; NULL for guest actions, or after that admin was removed.';
create index ix_credit_ledger_user    on public.credit_ledger (user_id, created_at desc);
create index ix_credit_ledger_payment on public.credit_ledger (payment_id);
create index ix_credit_ledger_session on public.credit_ledger (session_id);
create index ix_credit_ledger_admin   on public.credit_ledger (admin_id);

alter table public.credit_ledger enable row level security;
revoke all on table public.credit_ledger from anon, authenticated;

-- Only ledger_add() may change scan_credits: it raises a transaction-local
-- flag around its own update. Any other write (a hand-written UPDATE, a
-- future function that forgets the ledger) fails loudly instead of letting the
-- balance drift from the ledger.
create function public.profiles_guard_credits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scan_credits is distinct from old.scan_credits
     and current_setting('introchat.ledger_write', true) is distinct from 'on' then
    raise exception 'SCAN_CREDITS_LEDGER_ONLY';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_guard_credits() from public, anon, authenticated;

create trigger trg_profiles_guard_credits
  before update of scan_credits on public.profiles
  for each row execute function public.profiles_guard_credits();

-- Adds a ledger row and moves the balance with it. Returns the new balance.
-- NO_CREDITS when it would go below zero. Callers hold the profile lock
-- (lock order profile → session → payment, §9); this takes it too, harmlessly.
create function public.ledger_add(
  p_user_id    uuid,
  p_delta      integer,
  p_reason     text,
  p_payment_id uuid default null,
  p_session_id uuid default null,
  p_admin_id   uuid default null,
  p_note       text default null
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_balance integer;
begin
  select p.scan_credits into v_balance from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'NOT_A_GUEST';
  end if;
  if v_balance + p_delta < 0 then
    raise exception 'NO_CREDITS';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, payment_id, session_id, admin_id, note)
  values (p_user_id, p_delta, p_reason, p_payment_id, p_session_id, p_admin_id, p_note);
  perform set_config('introchat.ledger_write', 'on', true);
  update public.profiles set scan_credits = v_balance + p_delta where id = p_user_id;
  perform set_config('introchat.ledger_write', 'off', true);
  return v_balance + p_delta;
end;
$$;
revoke all on function public.ledger_add(uuid, integer, text, uuid, uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Settings the Console must not edit
-- -----------------------------------------------------------------------------
-- These change together with code or deployment, never on their own: a new
-- CONSENT_VERSION without the new notice text in the app would lock every
-- guest out (CONSENT_VERSION_OUTDATED); SMS_PROVIDER = twilio is not built;
-- PUSH_FUNCTION_URL is per-project deployment configuration.
alter table public.app_settings add column admin_editable boolean not null default true;
comment on column public.app_settings.admin_editable is
  'false = changed only by a migration, because the app''s code must change with it.';
update public.app_settings set admin_editable = false
where key in ('CONSENT_VERSION', 'SMS_PROVIDER', 'PUSH_FUNCTION_URL');

-- -----------------------------------------------------------------------------
-- What the app receives about a session: now also the money facts
-- -----------------------------------------------------------------------------
-- The popups (§4.11) are built on the phone from these; the server enforces
-- the same rules again in continue_with_credit / prepare_payment.
alter type public.session_state add attribute scan_credits integer;
alter type public.session_state add attribute continue_fee_paise integer;
alter type public.session_state add attribute continue_minutes integer;
alter type public.session_state add attribute subscription_enabled boolean;
alter type public.session_state add attribute subscription_price_paise integer;
alter type public.session_state add attribute subscription_scans integer;
alter type public.session_state add attribute subscription_session_minutes integer;

create or replace function public.session_state_of(p_session_id uuid)
returns public.session_state
language plpgsql
stable
set search_path = ''
as $$
declare
  s          public.sessions%rowtype;
  r          public.session_state;
  v_payments boolean;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  v_payments := public.setting_bool('PAYMENTS_ENABLED', s.venue_id);
  r.session_id                   := s.id;
  r.status                       := s.status;
  r.end_reason                   := s.end_reason;
  r.kind                         := s.kind;
  r.venue_name                   := (select v.name from public.venues v where v.id = s.venue_id);
  r.table_label                  := (select t.label from public.tables t where t.id = s.table_id);
  r.started_at                   := s.started_at;
  r.expires_at                   := s.expires_at;
  r.warning_at                   := s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id));
  r.final_deadline_at            := s.final_deadline_at;
  r.final_prompt_seconds         := public.setting_int('FINAL_PROMPT_SECONDS');
  r.away_since                   := s.away_since;
  r.away_grace_seconds           := public.setting_int('AWAY_GRACE_SECONDS', s.venue_id);
  r.payments_enabled             := v_payments;
  r.continue_free_minutes        := public.setting_int('FREE_SESSION_MINUTES', s.venue_id);
  r.heartbeat_seconds            := public.setting_int('HEARTBEAT_INTERVAL_SECONDS');
  r.location_seconds             := public.setting_int('LOCATION_INTERVAL_SECONDS');
  r.venue_id                     := s.venue_id;
  r.scan_credits                 := (select p.scan_credits from public.profiles p where p.id = s.user_id);
  r.continue_fee_paise           := public.setting_int('CONTINUE_FEE_PAISE', s.venue_id);
  r.continue_minutes             := public.setting_int('CONTINUE_MINUTES', s.venue_id);
  -- The master switch overrides the others (§2.3).
  r.subscription_enabled         := v_payments and public.setting_bool('SUBSCRIPTION_ENABLED', s.venue_id);
  r.subscription_price_paise     := public.setting_int('SUBSCRIPTION_PRICE_PAISE');
  r.subscription_scans           := public.setting_int('SUBSCRIPTION_SCANS');
  r.subscription_session_minutes := public.setting_int('SUBSCRIPTION_SESSION_MINUTES');
  -- The wall clock at the moment of answering, not the transaction start.
  r.server_now                   := clock_timestamp();
  return r;
end;
$$;
revoke all on function public.session_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Entry: shared checks, and what entering costs right now
-- -----------------------------------------------------------------------------
-- Everything that must hold before a guest may enter a venue (or pay to).
-- Shared by start_session and prepare_payment so both refuse the same cases.
create function public.check_may_enter(p_profile public.profiles, p_venue_id uuid, p_device_id text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if p_profile.age_blocked then
    raise exception 'AGE_BLOCKED';
  end if;
  if p_profile.consent_version is distinct from (public.setting('CONSENT_VERSION') #>> '{}') then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if p_profile.birth_year is null
     or not exists (select 1 from public.user_tags ut where ut.user_id = p_profile.id) then
    raise exception 'PROFILE_INCOMPLETE';
  end if;
  if public.active_ban_exists(p_profile.id, p_profile.phone_hash, p_device_id) then
    raise exception 'BANNED';
  end if;
  select max(coalesce(b.expires_at, 'infinity')) into v_until
  from public.bans b
  where b.scope = 'venue' and b.venue_id = p_venue_id and b.lifted_at is null
    and (b.expires_at is null or b.expires_at > now())
    and (b.user_id = p_profile.id or b.phone_hash = p_profile.phone_hash or b.device_id = p_device_id);
  if v_until is not null then
    raise exception 'KICKED_COOLDOWN' using detail = jsonb_build_object('until', v_until)::text;
  end if;
end;
$$;
revoke all on function public.check_may_enter(public.profiles, uuid, text) from public, anon, authenticated;

-- The reading must say "inside"; returns the distance for the session record.
create function public.require_inside(
  p_venue_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision
)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_loc record;
begin
  select * into v_loc from public.evaluate_location(p_venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds);
  if v_loc.state = 'outside' then
    raise exception 'NOT_AT_VENUE';
  elsif v_loc.state = 'unknown' then
    raise exception 'LOCATION_INACCURATE';
  end if;
  return v_loc.distance_m;
end;
$$;
revoke all on function public.require_inside(uuid, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- What entering this venue costs this guest right now, in the order of §4.5:
--   resume            a paid session here ended early (left / logged out) and
--                     its paid time is not over: continue it free (decision 14)
--   free              the scan fee is off for this venue
--   credit            the guest has scan credits: one is used
--   unused_payment    a paid, unused entry or continue fee here, under
--                     UNUSED_FEE_VALID_MINUTES old (so paying, then crashing
--                     before joining, never charges twice)
--   payment_required  none of the above
-- The single source of truth for start_session and prepare_payment.
create function public.entry_basis(p_user_id uuid, p_venue_id uuid)
returns table (basis text, resume_from uuid, payment_id uuid)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  select s.id into resume_from
  from public.sessions s
  where s.user_id = p_user_id and s.venue_id = p_venue_id and s.status = 'ended'
    and s.end_reason in ('left_venue', 'user_logout')
    and s.kind in ('paid_scan', 'subscription')
    and s.expires_at > now()
    and not exists (select 1 from public.sessions r where r.resumed_from = s.id)
  order by s.ended_at desc
  limit 1;
  if resume_from is not null then
    basis := 'resume';
    return next;
    return;
  end if;

  if not (public.setting_bool('PAYMENTS_ENABLED', p_venue_id) and public.setting_bool('SCAN_FEE_ENABLED', p_venue_id)) then
    basis := 'free';
    return next;
    return;
  end if;

  if (select p.scan_credits from public.profiles p where p.id = p_user_id) > 0 then
    basis := 'credit';
    return next;
    return;
  end if;

  select x.id into payment_id
  from public.payments x
  where x.user_id = p_user_id and x.venue_id = p_venue_id and x.status = 'paid'
    and x.session_id is null and x.purpose in ('scan_fee', 'continue')
    and x.paid_at > now() - make_interval(mins => public.setting_int('UNUSED_FEE_VALID_MINUTES'))
  order by x.paid_at
  limit 1;
  basis := case when payment_id is null then 'payment_required' else 'unused_payment' end;
  return next;
end;
$$;
revoke all on function public.entry_basis(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- start_session: free, resume, credit, or a paid entry (§4.5)
-- -----------------------------------------------------------------------------
create or replace function public.start_session(
  p_slug        text,
  p_qr_token    text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_age_seconds double precision,
  p_device_id   text
)
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user     uuid := public.require_guest();
  v_profile  public.profiles%rowtype;
  v_scan     record;
  v_distance integer;
  v_live     public.sessions%rowtype;
  v_basis    record;
  v_prev     public.sessions%rowtype;
  v_kind     text;
  v_minutes  integer;
  v_taken    timestamptz;
  v_id       uuid;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'DEVICE_ID_INVALID';
  end if;
  perform public.check_rate_limit('start_session:' || v_user, 20, interval '1 minute');

  -- Lock order profile → session → payment (§9). Holding the profile lock
  -- also serialises two tabs starting at once, and a payment being applied.
  select * into v_profile from public.profiles where id = v_user for update;
  select * into v_scan from public.resolve_scan(p_slug, p_qr_token);
  perform public.check_may_enter(v_profile, v_scan.venue_id, p_device_id);
  v_distance := public.require_inside(v_scan.venue_id, p_latitude, p_longitude, p_accuracy_m, p_age_seconds);

  v_live := public.lock_live_session(v_user);
  if v_live.id is not null then
    -- Reload or a second scan at the same venue: same session, same timer.
    if v_live.venue_id = v_scan.venue_id then
      return public.session_state_of(v_live.id);
    end if;
    perform public.end_session(v_live.id, 'left_venue');
  end if;

  select * into v_basis from public.entry_basis(v_user, v_scan.venue_id);
  v_taken := now() - make_interval(secs => greatest(p_age_seconds, 0));

  if v_basis.basis = 'resume' then
    select * into v_prev from public.sessions where id = v_basis.resume_from;
    insert into public.sessions (
      user_id, venue_id, table_id, kind, status, started_at, block_started_at, expires_at,
      last_seen_at, location_state, location_checked_at, last_lat, last_lng, last_taken_at,
      start_distance_m, start_accuracy_m, device_id, resumed_from)
    values (
      v_user, v_scan.venue_id, v_scan.table_id, v_prev.kind, 'active', now(), v_prev.block_started_at,
      v_prev.expires_at, now(), 'inside', v_taken, p_latitude, p_longitude, v_taken,
      v_distance, round(p_accuracy_m)::integer, p_device_id, v_prev.id)
    returning id into v_id;
    return public.session_state_of(v_id);
  end if;

  if v_basis.basis = 'payment_required' then
    raise exception 'PAYMENT_REQUIRED' using detail = jsonb_build_object(
      'scan_fee_paise', public.setting_int('SCAN_FEE_PAISE', v_scan.venue_id),
      'scan_session_minutes', public.setting_int('SCAN_SESSION_MINUTES', v_scan.venue_id),
      'subscription_on', public.setting_bool('SUBSCRIPTION_ENABLED', v_scan.venue_id),
      'subscription_price_paise', public.setting_int('SUBSCRIPTION_PRICE_PAISE'),
      'subscription_scans', public.setting_int('SUBSCRIPTION_SCANS'))::text;
  end if;

  v_kind := case v_basis.basis when 'free' then 'free' when 'credit' then 'subscription' else 'paid_scan' end;
  v_minutes := case v_basis.basis
    when 'free'   then public.setting_int('FREE_SESSION_MINUTES', v_scan.venue_id)
    when 'credit' then public.setting_int('SUBSCRIPTION_SESSION_MINUTES')
    else public.setting_int('SCAN_SESSION_MINUTES', v_scan.venue_id)
  end;
  if v_basis.basis = 'unused_payment' then
    perform 1 from public.payments where id = v_basis.payment_id for update;
  end if;

  insert into public.sessions (
    user_id, venue_id, table_id, kind, status, started_at, block_started_at, expires_at,
    last_seen_at, location_state, location_checked_at, last_lat, last_lng, last_taken_at,
    start_distance_m, start_accuracy_m, device_id)
  values (
    v_user, v_scan.venue_id, v_scan.table_id, v_kind, 'active', now(), now(),
    now() + make_interval(mins => v_minutes),
    now(), 'inside', v_taken, p_latitude, p_longitude, v_taken,
    v_distance, round(p_accuracy_m)::integer, p_device_id)
  returning id into v_id;

  if v_basis.basis = 'credit' then
    perform public.ledger_add(v_user, -1, 'session_start', null, v_id);
  elsif v_basis.basis = 'unused_payment' then
    update public.payments set session_id = v_id where id = v_basis.payment_id;
  end if;
  return public.session_state_of(v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- end_session: subscribers keep their chats (decision 10)
-- -----------------------------------------------------------------------------
-- Closes a guest's chats: the other person is told (their copy turns
-- read-only); with p_hide the guest's own view goes, and conversations nobody
-- sees any more are deleted with their messages.
create function public.close_conversations_of(p_user_id uuid, p_hide boolean)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select m.conversation_id from public.conversation_members m
    where m.user_id = p_user_id and m.hidden_at is null
    for update
  loop
    if p_hide then
      update public.conversation_members set hidden_at = now()
      where conversation_id = r.conversation_id and user_id = p_user_id;
    end if;
    perform public.notify('user:' || o.user_id::text, 'chat.closed', jsonb_build_object('conversation_id', r.conversation_id))
    from public.conversation_members o
    where o.conversation_id = r.conversation_id and o.user_id <> p_user_id and o.hidden_at is null;
  end loop;
  if p_hide then
    delete from public.conversations c
    where (c.user_low_id = p_user_id or c.user_high_id = p_user_id)
      and not exists (select 1 from public.conversation_members m
                      where m.conversation_id = c.id and m.hidden_at is null);
  end if;
end;
$$;
revoke all on function public.close_conversations_of(uuid, boolean) from public, anon, authenticated;

create or replace function public.end_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
  r record;
begin
  if p_reason is null or p_reason not in
     ('expired', 'left_venue', 'user_logout', 'kicked', 'banned', 'venue_closed') then
    raise exception 'END_REASON_INVALID' using detail = coalesce(p_reason, 'null');
  end if;
  select * into s from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if s.status = 'ended' then
    return;
  end if;

  update public.sessions
  set status            = 'ended',
      ended_at          = now(),
      end_reason        = p_reason,
      final_deadline_at = null,
      away_since        = null,
      -- The raw position is kept only while the session is live (§3.4).
      last_lat          = null,
      last_lng          = null,
      last_taken_at     = null
  where id = s.id;

  -- Requests to or from this visit can no longer be answered.
  for r in
    update public.chat_requests
    set status = 'cancelled', responded_at = now()
    where status = 'pending' and (from_session_id = s.id or to_session_id = s.id)
    returning id, case when from_user_id = s.user_id then to_user_id else from_user_id end as other_user
  loop
    perform public.notify('user:' || r.other_user::text, 'request.cancelled', jsonb_build_object('request_id', r.id));
  end loop;

  -- A subscriber (scan credits left) keeps their chats for the next visit;
  -- everyone else loses them now (decision 10). This session is already
  -- ended, so "subscriber" here means credits only (§4.13).
  perform public.close_conversations_of(
    s.user_id,
    coalesce((select p.scan_credits from public.profiles p where p.id = s.user_id), 0) = 0);

  if p_reason in ('kicked', 'banned', 'venue_closed') then
    perform public.write_audit('system', null, 'session.end', 'session', s.id, s.venue_id,
                               jsonb_build_object('reason', p_reason));
  end if;
end;
$$;
revoke all on function public.end_session(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Continue with a scan credit (§4.11)
-- -----------------------------------------------------------------------------
create function public.continue_with_credit()
returns public.session_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.require_guest();
  s       public.sessions%rowtype;
  v_start timestamptz;
begin
  perform 1 from public.profiles where id = v_user for update;
  s := public.lock_live_session(v_user);
  if s.id is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  -- With payments off, continuing is free; a credit would be wasted.
  if not public.setting_bool('PAYMENTS_ENABLED', s.venue_id) then
    raise exception 'FEATURE_DISABLED';
  end if;
  if s.status = 'active'
     and now() < s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id)) then
    raise exception 'CONTINUE_NOT_AVAILABLE';
  end if;

  perform public.ledger_add(v_user, -1, 'continue', null, s.id);
  v_start := greatest(s.expires_at, now());
  update public.sessions
  set kind               = 'subscription',
      status             = 'active',
      block_started_at   = v_start,
      expires_at         = v_start + make_interval(mins => public.setting_int('SUBSCRIPTION_SESSION_MINUTES')),
      warning_sent_at    = null,
      final_deadline_at  = null,
      payment_grace_used = false
  where id = s.id;
  return public.session_state_of(s.id);
end;
$$;
revoke all on function public.continue_with_credit() from public, anon, authenticated;
grant execute on function public.continue_with_credit() to authenticated;

-- -----------------------------------------------------------------------------
-- Payments: service-role functions used by the payments-* Edge Functions
-- -----------------------------------------------------------------------------
-- Creates a payment for the signed-in guest (the Edge Function verified who
-- they are). Amounts come from settings, never from the phone. In the final
-- prompt it also gives the guest PAYMENT_GRACE_SECONDS to finish paying, once
-- per block (§4.10).
--   scan_fee      entry; only when entering would otherwise be refused (PAYMENT_REQUIRED)
--   continue      in the warning window or the final prompt, without credits
--   subscription  at entry or during a live session, when the switch is on
-- p_slug / p_qr_token / reading / device: required at entry, ignored in a session.
create function public.prepare_payment(
  p_user_id     uuid,
  p_purpose     text,
  p_slug        text             default null,
  p_qr_token    text             default null,
  p_latitude    double precision default null,
  p_longitude   double precision default null,
  p_accuracy_m  double precision default null,
  p_age_seconds double precision default null,
  p_device_id   text             default null
)
returns table (payment_id uuid, amount_paise integer, currency text, purpose text, venue_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  s         public.sessions%rowtype;
  v_scanned uuid;
  v_venue   uuid;
  v_entry   boolean;
  v_amount  integer;
  v_id      uuid;
begin
  if p_purpose is null or p_purpose not in ('scan_fee', 'continue', 'subscription') then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"purpose"}';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'NOT_A_GUEST';
  end if;
  perform public.check_rate_limit('payment_create:' || p_user_id, 10, interval '1 hour');
  s := public.lock_live_session(p_user_id);

  -- Entry = paying at a scanned table where the guest is not already in a session.
  if p_slug is not null then
    select r.venue_id into v_scanned from public.resolve_scan(p_slug, p_qr_token) r;
  end if;
  v_entry := v_scanned is not null and (s.id is null or s.venue_id <> v_scanned);

  if v_entry then
    if p_purpose = 'continue' then
      raise exception 'VALIDATION_FAILED' using detail = '{"field":"purpose"}';
    end if;
    if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{8,64}$' then
      raise exception 'DEVICE_ID_INVALID';
    end if;
    v_venue := v_scanned;
    perform public.check_may_enter(v_profile, v_venue, p_device_id);
    -- Nobody pays from home and is then refused at the door (§3.3).
    perform public.require_inside(v_venue, p_latitude, p_longitude, p_accuracy_m, p_age_seconds);
    if p_purpose = 'scan_fee'
       and (select b.basis from public.entry_basis(p_user_id, v_venue) b) <> 'payment_required' then
      raise exception 'PAYMENT_NOT_NEEDED';
    end if;
  else
    if s.id is null then
      raise exception 'SESSION_NOT_ACTIVE';
    end if;
    if p_purpose = 'scan_fee' then
      raise exception 'PAYMENT_NOT_NEEDED';
    end if;
    v_venue := s.venue_id;
    if p_purpose = 'continue' then
      if v_profile.scan_credits > 0 then
        -- They continue with a scan instead (continue_with_credit).
        raise exception 'PAYMENT_NOT_NEEDED';
      end if;
      if s.status = 'active'
         and now() < s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', v_venue)) then
        raise exception 'CONTINUE_NOT_AVAILABLE';
      end if;
    end if;
  end if;

  if not public.setting_bool('PAYMENTS_ENABLED', v_venue)
     or (p_purpose = 'scan_fee' and not public.setting_bool('SCAN_FEE_ENABLED', v_venue))
     or (p_purpose = 'subscription' and not public.setting_bool('SUBSCRIPTION_ENABLED', v_venue)) then
    raise exception 'FEATURE_DISABLED';
  end if;

  if not v_entry and s.status = 'final_prompt' and not s.payment_grace_used then
    update public.sessions
    set final_deadline_at  = greatest(final_deadline_at, now() + make_interval(secs => public.setting_int('PAYMENT_GRACE_SECONDS'))),
        payment_grace_used = true
    where id = s.id;
  end if;

  v_amount := case p_purpose
    when 'scan_fee' then public.setting_int('SCAN_FEE_PAISE', v_venue)
    when 'continue' then public.setting_int('CONTINUE_FEE_PAISE', v_venue)
    else public.setting_int('SUBSCRIPTION_PRICE_PAISE')
  end;
  insert into public.payments (user_id, venue_id, purpose, amount_paise)
  values (p_user_id, v_venue, p_purpose, v_amount)
  returning id into v_id;
  return query
    select v_id, v_amount, 'INR'::text, p_purpose, v.name from public.venues v where v.id = v_venue;
end;
$$;

-- Records the Razorpay order created for a payment. Once only.
create function public.payment_set_order(p_payment_id uuid, p_order_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_order_id is null or p_order_id !~ '^order_[A-Za-z0-9]{6,40}$' then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"order_id"}';
  end if;
  update public.payments set provider_order_id = p_order_id
  where id = p_payment_id and status = 'created' and provider_order_id is null;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
end;
$$;

-- The order could not be created at Razorpay: the attempt is over.
create function public.payment_mark_failed(p_payment_id uuid, p_raw jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.payments set status = 'failed', failed_at = now(), raw = p_raw
  where id = p_payment_id and status = 'created';
$$;

-- What payments-verify needs to check a Checkout result. NULL row = no such payment.
create function public.payment_for_verify(p_payment_id uuid)
returns table (user_id uuid, provider_order_id text, amount_paise integer, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.provider_order_id, p.amount_paise, p.status from public.payments p where p.id = p_payment_id;
$$;

-- What payments-webhook needs: our payment for a Razorpay order.
create function public.payment_by_order(p_order_id text)
returns table (payment_id uuid, amount_paise integer, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.amount_paise, p.status from public.payments p where p.provider_order_id = p_order_id;
$$;

-- Marks a payment paid and gives the guest what they paid for (§4.10). Called
-- by both payments-verify and payments-webhook; whichever arrives first
-- applies it, the other gets 'already_applied'. A payment is applied once,
-- ever: the status update is the guard. A success arriving after the 24 h job
-- marked the attempt failed is still applied: the money was taken.
create function public.apply_payment(
  p_payment_id          uuid,
  p_provider_payment_id text,
  p_amount_paise        integer,
  p_raw                 jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p             public.payments%rowtype;
  s             public.sessions%rowtype;
  v_start       timestamptz;
  v_minutes     integer;
  v_new_expires timestamptz;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if p_amount_paise is distinct from p.amount_paise then
    raise exception 'PAYMENT_AMOUNT_MISMATCH'
      using detail = jsonb_build_object('expected', p.amount_paise, 'received', p_amount_paise)::text;
  end if;
  if p.status in ('paid', 'refunded') then
    return 'already_applied';
  end if;

  -- Lock order profile → session → payment (§9).
  if p.user_id is not null then
    perform 1 from public.profiles where id = p.user_id for update;
    s := public.lock_live_session(p.user_id);
  end if;
  update public.payments
  set status = 'paid', paid_at = now(), failed_at = null,
      provider_payment_id = p_provider_payment_id, raw = p_raw
  where id = p.id and status in ('created', 'failed')
  returning * into p;
  if not found then
    return 'already_applied';
  end if;
  if p.user_id is null then
    -- The account was deleted while paying: the money is recorded; an admin refunds it.
    return 'applied';
  end if;

  if p.purpose = 'continue' and s.id is not null and s.venue_id = p.venue_id then
    v_start := greatest(s.expires_at, now());
    update public.sessions
    set kind = 'paid_scan', status = 'active', block_started_at = v_start,
        expires_at = v_start + make_interval(mins => public.setting_int('CONTINUE_MINUTES', s.venue_id)),
        warning_sent_at = null, final_deadline_at = null, payment_grace_used = false
    where id = s.id;
    update public.payments set session_id = s.id where id = p.id;
  elsif p.purpose = 'subscription' then
    perform public.ledger_add(p.user_id, public.setting_int('SUBSCRIPTION_SCANS'), 'purchase', p.id);
    -- Bought during a paid or free session here: that session becomes a
    -- subscription session of 2 hours from its block start, using one scan
    -- (decision 12). (If that end is already past, e.g. after a long final
    -- prompt, the block restarts now so the scan is never wasted.)
    if s.id is not null and s.venue_id = p.venue_id and s.kind <> 'subscription' then
      perform public.ledger_add(p.user_id, -1, 'session_upgrade', p.id, s.id);
      v_minutes := public.setting_int('SUBSCRIPTION_SESSION_MINUTES');
      v_new_expires := greatest(s.expires_at, s.block_started_at + make_interval(mins => v_minutes));
      update public.sessions
      set kind = 'subscription', status = 'active',
          block_started_at = case when v_new_expires <= now() then now() else block_started_at end,
          expires_at = case when v_new_expires <= now() then now() + make_interval(mins => v_minutes) else v_new_expires end,
          warning_sent_at = null, final_deadline_at = null, payment_grace_used = false
      where id = s.id;
      update public.payments set session_id = s.id where id = p.id;
    end if;
  end if;
  -- 'scan_fee' (and a 'continue' paid after the session ended) stays unused:
  -- start_session uses it at this venue within UNUSED_FEE_VALID_MINUTES.

  perform public.notify('user:' || p.user_id::text, 'payment.applied',
                        jsonb_build_object('payment_id', p.id, 'purpose', p.purpose));
  return 'applied';
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('prepare_payment', 'payment_set_order', 'payment_mark_failed',
                        'payment_for_verify', 'payment_by_order', 'apply_payment')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Hourly clean-up: abandoned checkouts
-- -----------------------------------------------------------------------------
create or replace function public.hourly_cleanup()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rate     integer;
  v_sms      integer;
  v_cron     integer;
  v_payments integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;
  delete from public.sms_log where created_at < now() - interval '30 days';
  get diagnostics v_sms = row_count;
  delete from cron.job_run_details where end_time < now() - interval '1 day';
  get diagnostics v_cron = row_count;
  -- A checkout nobody finished in 24 h is over (§4.10). A late success is
  -- still applied by apply_payment.
  update public.payments set status = 'failed', failed_at = now()
  where status = 'created' and created_at < now() - interval '24 hours';
  get diagnostics v_payments = row_count;
  return jsonb_build_object('rate_limits', v_rate, 'sms_log', v_sms, 'cron_history', v_cron,
                            'payments_failed', v_payments);
end;
$$;
revoke all on function public.hourly_cleanup() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Admin Console
-- -----------------------------------------------------------------------------
create function public.admin_list_payments(
  p_status   text    default null,
  p_venue_id uuid    default null,
  p_limit    integer default 100
)
returns table (
  payment_id          uuid,
  created_at          timestamptz,
  paid_at             timestamptz,
  refunded_at         timestamptz,
  status              text,
  purpose             text,
  amount_paise        integer,
  venue_name          text,
  guest_handle        text,
  provider_payment_id text,
  refund_note         text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select p.id, p.created_at, p.paid_at, p.refunded_at, p.status, p.purpose, p.amount_paise,
           v.name, g.handle, p.provider_payment_id, p.refund_note
    from public.payments p
    join public.venues v on v.id = p.venue_id
    left join public.profiles g on g.id = p.user_id
    where (p_status is null or p.status = p_status)
      and (p_venue_id is null or p.venue_id = p_venue_id)
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Records a refund already made in the Razorpay dashboard (§4.10). For a
-- subscription, the scans it bought that are still unused are removed (never
-- below 0); a guest left with no scans and no live session loses the chat
-- history the subscription was keeping.
create function public.admin_mark_payment_refunded(p_payment_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p          public.payments%rowtype;
  v_balance  integer;
  v_bought   integer;
  v_remove   integer;
begin
  perform public.require_admin();
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select * into p from public.payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  -- Lock order profile → payment (§9).
  if p.user_id is not null then
    select g.scan_credits into v_balance from public.profiles g where g.id = p.user_id for update;
  end if;
  update public.payments
  set status = 'refunded', refunded_at = now(), refunded_by = auth.uid(), refund_note = btrim(p_note)
  where id = p.id and status = 'paid'
  returning * into p;
  if not found then
    raise exception 'PAYMENT_NOT_REFUNDABLE';
  end if;

  if p.purpose = 'subscription' and p.user_id is not null then
    select coalesce(sum(l.delta), 0) into v_bought from public.credit_ledger l
    where l.payment_id = p.id and l.reason = 'purchase';
    v_remove := least(v_balance, v_bought);
    if v_remove > 0 then
      perform public.ledger_add(p.user_id, -v_remove, 'refund_adjust', p.id, null, auth.uid(), btrim(p_note));
    end if;
    if v_balance - v_remove = 0 and (public.live_session_of(p.user_id)).id is null then
      perform public.close_conversations_of(p.user_id, true);
    end if;
  end if;
  perform public.write_audit('admin', auth.uid(), 'payment.refund', 'payment', p.id, p.venue_id,
    jsonb_build_object('purpose', p.purpose, 'amount_paise', p.amount_paise, 'note', btrim(p_note)));
end;
$$;

-- A guest by their public handle, for granting scans or answering a complaint.
create function public.admin_find_guest(p_handle text)
returns table (user_id uuid, handle text, scan_credits integer, joined_at timestamptz, last_visit_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select g.id, g.handle, g.scan_credits, g.created_at,
           (select max(s.started_at) from public.sessions s where s.user_id = g.id)
    from public.profiles g
    where lower(g.handle) = lower(btrim(p_handle));
end;
$$;

create function public.admin_grant_scans(p_user_id uuid, p_scans integer, p_note text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  perform public.require_admin();
  if p_scans is null or p_scans not between 1 and 100 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"scans"}';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  v_balance := public.ledger_add(p_user_id, p_scans, 'admin_grant', null, null, auth.uid(), btrim(p_note));
  perform public.write_audit('admin', auth.uid(), 'credits.grant', 'guest', p_user_id, null,
    jsonb_build_object('scans', p_scans, 'note', btrim(p_note), 'balance', v_balance));
  return v_balance;
end;
$$;

create function public.admin_list_app_settings()
returns table (
  key               text,
  value_type        text,
  value             jsonb,
  min_value         numeric,
  max_value         numeric,
  allowed_values    text[],
  venue_overridable boolean,
  admin_editable    boolean,
  description       text,
  updated_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select s.key, s.value_type, s.value, s.min_value, s.max_value, s.allowed_values,
           s.venue_overridable, s.admin_editable, s.description, s.updated_at
    from public.app_settings s
    order by s.key;
end;
$$;

-- Changes one global setting (the payment switches, prices, durations...).
-- Validated against the setting's type and bounds; every change audited.
create function public.admin_set_app_setting(p_key text, p_value jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_setting public.app_settings%rowtype;
begin
  perform public.require_admin();
  select * into v_setting from public.app_settings where key = p_key for update;
  if not found then
    raise exception 'UNKNOWN_SETTING' using detail = coalesce(p_key, 'null');
  end if;
  if not v_setting.admin_editable then
    raise exception 'SETTING_NOT_EDITABLE' using detail = p_key;
  end if;
  if not public.setting_value_is_valid(v_setting.value_type, p_value, v_setting.min_value,
                                       v_setting.max_value, v_setting.allowed_values) then
    raise exception 'SETTING_VALUE_INVALID' using detail = p_key;
  end if;
  update public.app_settings set value = p_value, updated_by = auth.uid() where key = p_key;
  perform public.write_audit('admin', auth.uid(), 'setting.update', null, null, null,
    jsonb_build_object('key', p_key, 'before', v_setting.value, 'after', p_value));
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_list_payments', 'admin_mark_payment_refunded', 'admin_find_guest',
                        'admin_grant_scans', 'admin_list_app_settings', 'admin_set_app_setting')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
