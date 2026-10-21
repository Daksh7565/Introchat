-- =============================================================================
-- 0005 · remove admin email approvals: the hook refuses every email sign-up
--
-- Verified on dev after guest_identity was applied: Supabase Auth does not run
-- the before-user-created hook for users created through the Admin API (the
-- dashboard's "Add user", and the Console's admin invite in M7). Admins are only
-- ever created that way, so the approvals table would never be used. Removed
-- rather than kept as dead code; the hook now refuses all public email sign-ups.
-- =============================================================================

create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(trim(event -> 'user' ->> 'phone'), '');
  v_phone_normalized text;
begin
  -- Phone accounts (guests): +91 mobiles that are not banned. Who actually
  -- receives a code is also gated by the Send SMS hook (sms_hook_check).
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

  -- Email accounts are admins only, created through the Admin API, which does
  -- not run this hook. Any email sign-up reaching here is a public one.
  if nullif(trim(event -> 'user' ->> 'email'), '') is not null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_SIGNUP_DISABLED'));
  end if;

  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'SIGNUP_NOT_ALLOWED'));
end;
$$;

drop table public.admin_email_approvals;
