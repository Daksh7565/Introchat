-- =============================================================================
-- Migration console_ops (M7): what the Admin Console needs to run venues
-- without database access: live guests and kicks, close for today, location
-- (spoof) flags, stats, the audit log, SMS usage, admins, and account
-- deletion requests. ARCHITECTURE §4.16, §11. Decisions (all "A"): new admin
-- logins are created in the Supabase dashboard and only promoted here (no
-- passwords in our code); deletion is requested by the guest and processed
-- by an admin; stats are computed when asked (no nightly snapshot).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Live guests and kicks
-- -----------------------------------------------------------------------------
create function public.admin_live_guests(p_venue_id uuid)
returns table (
  session_id   uuid,
  user_id      uuid,
  handle       text,
  table_label  text,
  kind         text,
  status       text,
  started_at   timestamptz,
  expires_at   timestamptz,
  is_offline   boolean,
  away_since   timestamptz,
  spoof_flags  integer,
  scan_credits integer
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
    select s.id, s.user_id, p.handle, t.label, s.kind, s.status, s.started_at, s.expires_at,
           s.is_offline, s.away_since, jsonb_array_length(s.spoof_flags), p.scan_credits
    from public.sessions s
    join public.profiles p on p.id = s.user_id
    left join public.tables t on t.id = s.table_id
    where s.venue_id = p_venue_id and s.status <> 'ended'
    order by s.started_at;
end;
$$;

-- Ends a live visit and keeps the guest out of that venue for
-- KICK_COOLDOWN_HOURS (§4.15). No free resume after a kick.
create function public.admin_kick(p_session_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s      public.sessions%rowtype;
  v_hash text;
  v_note text := btrim(p_note);
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select * into s from public.sessions where id = p_session_id;
  if not found or s.status = 'ended' then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  -- Lock order profile → session (§9); kick_guest locks the session.
  select p.phone_hash into v_hash from public.profiles p where p.id = s.user_id for update;
  perform public.kick_guest(s.user_id, v_hash, s.venue_id, 'admin: ' || v_note, auth.uid());
  perform public.write_audit('admin', auth.uid(), 'guest.kick', 'session', s.id, s.venue_id,
    jsonb_build_object('note', v_note));
end;
$$;

-- -----------------------------------------------------------------------------
-- Close for today
-- -----------------------------------------------------------------------------
-- Ends every visit at the venue (venue_closed) and refuses scans until the
-- end of the venue's local day. Returns the visits that were paid for (a
-- paid entry or continue, or a subscription scan), so the admin can refund
-- or give the scan back: closing never refunds anything by itself.
create function public.admin_close_venue_today(p_venue_id uuid, p_note text)
returns table (
  session_id   uuid,
  handle       text,
  kind         text,
  payment_id   uuid,
  amount_paise integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v      public.venues%rowtype;
  v_note text := btrim(p_note);
  v_ids  uuid[];
  r      record;
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select * into v from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND';
  end if;

  -- Midnight at the venue, in its own timezone (§2.4).
  update public.venues
  set closed_until = (date_trunc('day', now() at time zone v.timezone) + interval '1 day') at time zone v.timezone
  where id = v.id;

  v_ids := array(select s.id from public.sessions s where s.venue_id = v.id and s.status <> 'ended');
  for r in select unnest(v_ids) as id loop
    perform public.end_session(r.id, 'venue_closed');
  end loop;

  perform public.write_audit('admin', auth.uid(), 'venue.close', 'venue', v.id, v.id,
    jsonb_build_object('note', v_note, 'sessions_ended', cardinality(v_ids)));

  return query
    select s.id, p.handle, s.kind, pay.id, pay.amount_paise
    from public.sessions s
    left join public.profiles p on p.id = s.user_id
    left join public.payments pay on pay.session_id = s.id and pay.status = 'paid'
    where s.id = any (v_ids) and s.kind in ('paid_scan', 'subscription')
    order by p.handle;
end;
$$;

create function public.admin_reopen_venue(p_venue_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(p_note);
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  update public.venues set closed_until = null where id = p_venue_id and closed_until is not null;
  if not found then
    raise exception 'VENUE_NOT_CLOSED';
  end if;
  perform public.write_audit('admin', auth.uid(), 'venue.reopen', 'venue', p_venue_id, p_venue_id,
    jsonb_build_object('note', v_note));
end;
$$;

-- -----------------------------------------------------------------------------
-- Location flags (§3.4: flagged for review, never acted on automatically)
-- -----------------------------------------------------------------------------
create function public.admin_list_spoof_flags(p_days integer default 7)
returns table (
  session_id       uuid,
  user_id          uuid,
  handle           text,
  venue_name       text,
  started_at       timestamptz,
  live             boolean,
  flags            jsonb,
  start_distance_m integer,
  start_accuracy_m integer
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
    select s.id, s.user_id, p.handle, v.name, s.started_at, s.status <> 'ended', s.spoof_flags,
           s.start_distance_m, s.start_accuracy_m
    from public.sessions s
    join public.profiles p on p.id = s.user_id
    join public.venues v on v.id = s.venue_id
    where jsonb_array_length(s.spoof_flags) > 0
      and s.started_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
    order by s.started_at desc
    limit 200;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stats, computed when asked (decision: no nightly snapshot at pilot scale)
-- -----------------------------------------------------------------------------
-- One venue (or all, p_venue_id NULL) over local dates p_from..p_to
-- inclusive, in the venue's timezone (all venues: Asia/Kolkata). Message
-- counts are left out on purpose: chats are deleted when visits end, so any
-- count would silently undercount.
create function public.admin_stats(p_venue_id uuid, p_from date, p_to date)
returns table (
  visits              integer,
  unique_guests       integer,
  avg_visit_minutes   integer,
  requests_sent       integer,
  requests_accepted   integer,
  reports             integer,
  payments            integer,
  revenue_paise       bigint,
  refunded_paise      bigint,
  guests_male         integer,
  guests_female       integer,
  guests_other        integer,
  guests_undisclosed  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz    text := coalesce((select v.timezone from public.venues v where v.id = p_venue_id), 'Asia/Kolkata');
  v_start timestamptz;
  v_end   timestamptz;
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"dates"}';
  end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  return query
    with visits as (
      select s.* from public.sessions s
      where (p_venue_id is null or s.venue_id = p_venue_id)
        and s.started_at >= v_start and s.started_at < v_end
    ),
    guests as (
      select distinct p.id, p.gender from visits s join public.profiles p on p.id = s.user_id
    ),
    money as (
      select x.* from public.payments x
      where (p_venue_id is null or x.venue_id = p_venue_id)
        and x.paid_at >= v_start and x.paid_at < v_end
    )
    select
      (select count(*)::integer from visits),
      (select count(*)::integer from guests),
      (select round(avg(extract(epoch from (s.ended_at - s.started_at)) / 60))::integer
       from visits s where s.ended_at is not null),
      (select count(*)::integer from public.chat_requests r
       where (p_venue_id is null or r.venue_id = p_venue_id) and r.created_at >= v_start and r.created_at < v_end),
      (select count(*)::integer from public.chat_requests r
       where (p_venue_id is null or r.venue_id = p_venue_id) and r.created_at >= v_start and r.created_at < v_end
         and r.status = 'accepted'),
      (select count(*)::integer from public.reports r
       where (p_venue_id is null or r.venue_id = p_venue_id) and r.created_at >= v_start and r.created_at < v_end),
      (select count(*)::integer from money),
      (select coalesce(sum(m.amount_paise), 0)::bigint from money m),
      (select coalesce(sum(m.amount_paise), 0)::bigint from money m where m.status = 'refunded'),
      (select count(*)::integer from guests g where g.gender = 'male'),
      (select count(*)::integer from guests g where g.gender = 'female'),
      (select count(*)::integer from guests g where g.gender = 'other'),
      (select count(*)::integer from guests g where g.gender is null or g.gender = 'prefer_not');
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit log and SMS usage
-- -----------------------------------------------------------------------------
-- Newest first, p_limit rows older than p_before (paging), optionally only
-- actions starting with p_action_prefix (e.g. 'payment.', 'ban.').
create function public.admin_list_audit(
  p_action_prefix text        default null,
  p_venue_id      uuid        default null,
  p_before        timestamptz default null,
  p_limit         integer     default 100
)
returns table (
  audit_id    bigint,
  created_at  timestamptz,
  actor_type  text,
  actor       text,
  action      text,
  target_type text,
  target_id   uuid,
  venue_name  text,
  meta        jsonb
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
    select a.id, a.created_at, a.actor_type,
           case a.actor_type
             when 'admin' then (select ad.email from public.admins ad where ad.user_id = a.actor_id)
             when 'guest' then (select g.handle from public.profiles g where g.id = a.actor_id)
           end,
           a.action, a.target_type, a.target_id, v.name, a.meta
    from public.audit_log a
    left join public.venues v on v.id = a.venue_id
    where (p_action_prefix is null or a.action like replace(replace(p_action_prefix, '%', ''), '_', '\_') || '%')
      and (p_venue_id is null or a.venue_id = p_venue_id)
      and (p_before is null or a.created_at < p_before)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- OTP SMS per India day (the SIM's daily limit runs on IST), by outcome and
-- refusal reason, for the last p_days days. The phone numbers are never here.
create function public.admin_sms_usage(p_days integer default 7)
returns table (day date, status text, reason text, attempts integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select (l.created_at at time zone 'Asia/Kolkata')::date, l.status, l.reason, count(*)::integer
    from public.sms_log l
    where l.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30))
    group by 1, 2, 3
    order by 1 desc, 2, 3;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admins
-- -----------------------------------------------------------------------------
create function public.admin_list_admins()
returns table (user_id uuid, email text, is_active boolean, has_mfa boolean, last_sign_in_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select a.user_id, a.email, a.is_active,
           exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'),
           u.last_sign_in_at, a.created_at
    from public.admins a
    join auth.users u on u.id = a.user_id
    order by a.is_active desc, a.email;
end;
$$;

-- Makes an existing email login an admin. The login itself is created in the
-- Supabase dashboard (decision: no passwords pass through our code); the new
-- admin then sets up 2-step verification at first sign-in.
create function public.admin_add_admin(p_email text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id    uuid;
begin
  perform public.require_admin();
  select u.id into v_id from auth.users u where lower(u.email) = v_email;
  if v_id is null then
    raise exception 'ADMIN_LOGIN_NOT_FOUND';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_id) then
    -- A guest (phone) account can never become an admin.
    raise exception 'ADMIN_LOGIN_NOT_FOUND';
  end if;
  insert into public.admins (user_id, email, created_by) values (v_id, v_email, auth.uid())
  on conflict (user_id) do nothing;
  if not found then
    raise exception 'ADMIN_EXISTS';
  end if;
  perform public.write_audit('admin', auth.uid(), 'admin.add', 'admin', v_id, null, jsonb_build_object('email', v_email));
  return v_id;
end;
$$;

-- Deactivating takes effect at once (is_admin checks it on every call). An
-- admin cannot deactivate themselves, and the last active admin stays.
create function public.admin_set_admin_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_active is null then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"active"}';
  end if;
  if not p_active and p_user_id = auth.uid() then
    raise exception 'ADMIN_SELF';
  end if;
  -- Serialises two admins deactivating each other at the same moment.
  perform 1 from public.admins where is_active for update;
  update public.admins set is_active = p_active where user_id = p_user_id;
  if not found then
    raise exception 'ADMIN_NOT_FOUND';
  end if;
  if not exists (select 1 from public.admins where is_active) then
    raise exception 'LAST_ADMIN';
  end if;
  perform public.write_audit('admin', auth.uid(), case when p_active then 'admin.activate' else 'admin.deactivate' end,
    'admin', p_user_id, null, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Account deletion (§11): requested by the guest, processed by an admin
-- -----------------------------------------------------------------------------
create table public.account_deletion_requests (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references public.profiles (id) on delete set null,
  handle       text        not null,
  status       text        not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_by uuid        references public.admins (user_id) on delete set null,
  processed_at timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ck_deletion_status    check (status in ('pending', 'completed', 'cancelled')),
  constraint ck_deletion_processed check ((status = 'pending') = (processed_at is null)),
  constraint ck_deletion_note      check (note is null or char_length(note) between 1 and 500)
);
comment on table public.account_deletion_requests is
  'A guest''s request to delete their account; done by an admin within 30 days (§11). Kept after deletion as proof it was done.';
comment on column public.account_deletion_requests.user_id is 'NULL once the account is deleted; handle is the snapshot.';
create unique index uq_deletion_pending on public.account_deletion_requests (user_id) where status = 'pending';
create index ix_deletion_status on public.account_deletion_requests (status, requested_at);
create index ix_deletion_processed_by on public.account_deletion_requests (processed_by);

create trigger trg_deletion_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;

-- The guest's pending request, if any (its date).
create function public.my_deletion_request()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
begin
  return (select d.requested_at from public.account_deletion_requests d
          where d.user_id = v_user and d.status = 'pending');
end;
$$;

-- Asks for deletion; asking again returns the same request's date.
create function public.request_account_deletion()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
  v_at   timestamptz;
begin
  perform 1 from public.profiles where id = v_user for update;
  select d.requested_at into v_at from public.account_deletion_requests d
  where d.user_id = v_user and d.status = 'pending';
  if v_at is null then
    insert into public.account_deletion_requests (user_id, handle)
    select v_user, p.handle from public.profiles p where p.id = v_user
    returning requested_at into v_at;
    perform public.write_audit('guest', v_user, 'account.deletion_requested', 'guest', v_user, null, '{}'::jsonb);
  end if;
  return v_at;
end;
$$;

create function public.cancel_account_deletion()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_guest();
begin
  update public.account_deletion_requests set status = 'cancelled', processed_at = now()
  where user_id = v_user and status = 'pending';
  if not found then
    raise exception 'DELETION_NOT_REQUESTED';
  end if;
  perform public.write_audit('guest', v_user, 'account.deletion_cancelled', 'guest', v_user, null, '{}'::jsonb);
end;
$$;

create function public.admin_list_deletion_requests(p_status text default 'pending')
returns table (
  request_id   uuid,
  handle       text,
  status       text,
  requested_at timestamptz,
  processed_at timestamptz,
  note         text,
  open_reports integer,
  active_ban   boolean
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
    select d.id, d.handle, d.status, d.requested_at, d.processed_at, d.note,
           -- Someone deleting to dodge a report is visible before acting.
           (select count(*)::integer from public.reports r where r.reported_id = d.user_id and r.status = 'open'),
           exists (select 1 from public.profiles p where p.id = d.user_id
                   and public.active_ban_exists(p.id, p.phone_hash, null))
    from public.account_deletion_requests d
    where p_status is null or d.status = p_status
    order by d.requested_at
    limit 500;
end;
$$;

-- Deletes the account (§11): the live visit ends, then the Supabase Auth
-- login is deleted, which removes the profile, interests, visits, chats,
-- requests, scan credits and push subscriptions with it (foreign-key
-- cascades). What stays, by design: payments (without the person, for
-- accounting), reports about them (handle and phone hash snapshots), and
-- bans (phone hash), so deleting an account never escapes a ban.
create function public.admin_process_deletion(p_request_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d      public.account_deletion_requests%rowtype;
  v_note text := btrim(p_note);
  s      public.sessions%rowtype;
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select * into d from public.account_deletion_requests where id = p_request_id for update;
  if not found or d.status <> 'pending' then
    raise exception 'DELETION_NOT_PENDING';
  end if;
  if d.user_id is not null then
    perform 1 from public.profiles where id = d.user_id for update;
    s := public.lock_live_session(d.user_id);
    if s.id is not null then
      perform public.end_session(s.id, 'user_logout');
    end if;
    delete from auth.users where id = d.user_id;
  end if;
  update public.account_deletion_requests
  set status = 'completed', processed_by = auth.uid(), processed_at = now(), note = v_note
  where id = d.id;
  perform public.write_audit('admin', auth.uid(), 'account.deleted', 'deletion_request', d.id, null,
    jsonb_build_object('handle', d.handle, 'note', v_note));
end;
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_live_guests', 'admin_kick', 'admin_close_venue_today', 'admin_reopen_venue',
                        'admin_list_spoof_flags', 'admin_stats', 'admin_list_audit', 'admin_sms_usage',
                        'admin_list_admins', 'admin_add_admin', 'admin_set_admin_active',
                        'my_deletion_request', 'request_account_deletion', 'cancel_account_deletion',
                        'admin_list_deletion_requests', 'admin_process_deletion')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
