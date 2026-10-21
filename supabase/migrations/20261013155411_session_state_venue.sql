-- =============================================================================
-- Migration session_state_venue (M4): the app needs the venue's id to listen
-- on its live channel (venue:{id}). The id is not secret: the channel itself
-- only lets in guests with a live session at that venue.
-- =============================================================================
alter type public.session_state add attribute venue_id uuid;

create or replace function public.session_state_of(p_session_id uuid)
returns public.session_state
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.sessions%rowtype;
  r public.session_state;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  r.session_id            := s.id;
  r.status                := s.status;
  r.end_reason            := s.end_reason;
  r.kind                  := s.kind;
  r.venue_name            := (select v.name from public.venues v where v.id = s.venue_id);
  r.table_label           := (select t.label from public.tables t where t.id = s.table_id);
  r.started_at            := s.started_at;
  r.expires_at            := s.expires_at;
  r.warning_at            := s.expires_at - make_interval(mins => public.setting_int('WARNING_BEFORE_MINUTES', s.venue_id));
  r.final_deadline_at     := s.final_deadline_at;
  r.final_prompt_seconds  := public.setting_int('FINAL_PROMPT_SECONDS');
  r.away_since            := s.away_since;
  r.away_grace_seconds    := public.setting_int('AWAY_GRACE_SECONDS', s.venue_id);
  r.payments_enabled      := public.setting_bool('PAYMENTS_ENABLED', s.venue_id);
  r.continue_free_minutes := public.setting_int('FREE_SESSION_MINUTES', s.venue_id);
  r.heartbeat_seconds     := public.setting_int('HEARTBEAT_INTERVAL_SECONDS');
  r.location_seconds      := public.setting_int('LOCATION_INTERVAL_SECONDS');
  r.venue_id              := s.venue_id;
  -- The wall clock at the moment of answering, not the transaction start.
  r.server_now            := clock_timestamp();
  return r;
end;
$$;
revoke all on function public.session_state_of(uuid) from public, anon, authenticated;
