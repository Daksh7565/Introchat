-- =============================================================================
-- Migration ban_days_default (M6): admin_ban_guest's p_days had no default,
-- so "permanent" (NULL) could only be sent as an explicit null, and the
-- generated client types required a number. Same function, with
-- p_days DEFAULT NULL (= permanent) as the last argument, like
-- admin_resolve_report.
-- =============================================================================
drop function public.admin_ban_guest(uuid, integer, text);

create function public.admin_ban_guest(p_user_id uuid, p_note text, p_days integer default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_note text := btrim(p_note);
  v_id   uuid;
begin
  perform public.require_admin();
  if v_note is null or char_length(v_note) not between 1 and 500 then
    raise exception 'VALIDATION_FAILED' using detail = '{"field":"note"}';
  end if;
  select p.phone_hash into v_hash from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'NOT_A_GUEST';
  end if;
  v_id := public.ban_guest(p_user_id, v_hash, p_days, 'admin: ' || v_note, auth.uid());
  perform public.write_audit('admin', auth.uid(), 'ban.create', 'guest', p_user_id, null,
    jsonb_build_object('ban_id', v_id, 'days', p_days, 'note', v_note));
  return v_id;
end;
$$;
revoke all on function public.admin_ban_guest(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.admin_ban_guest(uuid, text, integer) to authenticated;
