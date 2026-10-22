-- =============================================================================
-- Migration stats_venue_default (M7): admin_stats takes NULL for "all venues",
-- but its venue argument came first with no default, so the generated client
-- types required one. Same function, venue last and DEFAULT NULL.
-- =============================================================================
drop function public.admin_stats(uuid, date, date);

create function public.admin_stats(p_from date, p_to date, p_venue_id uuid default null)
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
revoke all on function public.admin_stats(date, date, uuid) from public, anon, authenticated;
grant execute on function public.admin_stats(date, date, uuid) to authenticated;
