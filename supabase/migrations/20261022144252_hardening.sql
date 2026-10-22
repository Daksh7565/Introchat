-- =============================================================================
-- Migration hardening (M8): findings of the security pass.
--   - session_state_of reads the wall clock (server_now) but was STABLE, so
--     Postgres could reuse one value within a statement: now VOLATILE, and so
--     is my_session, which calls it (supabase db lint).
--   - set_tags started from an untyped '{}' (lint: text to text[]).
--   - generate_qr_token declared a variable the loop shadowed (lint).
--   - update_profile: nickname and gender are optional, so they now default
--     to NULL ("not given") and come last; the app no longer has to cast a
--     null into a string to send "not given".
-- =============================================================================
alter function public.session_state_of(uuid) volatile;
alter function public.my_session() volatile;

create or replace function public.set_tags(p_names text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid := public.require_guest();
  v_max   integer := public.setting_int('MAX_TAGS_PER_USER');
  v_names text[] := '{}'::text[];
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

create or replace function public.generate_qr_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  token text := '';
  b integer;
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

drop function public.update_profile(integer, text, text, text);

-- Saves the profile. Returns 'ok', or 'under_age' when the birth year is under
-- MIN_AGE: that is recorded (age_blocked) rather than raised, because raising
-- would roll the record back and let the guest simply try another year.
create function public.update_profile(
  p_birth_year integer,
  p_language   text,
  p_nickname   text default null,
  p_gender     text default null
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
revoke all on function public.update_profile(integer, text, text, text) from public, anon, authenticated;
grant execute on function public.update_profile(integer, text, text, text) to authenticated;
