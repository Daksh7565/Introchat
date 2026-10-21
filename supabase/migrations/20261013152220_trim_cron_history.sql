-- =============================================================================
-- Migration trim_cron_history (M3): pg_cron writes one history row per run. The
-- 10-second tick alone adds 8 640 rows a day (~600 MB a year), more than the
-- free plan's 500 MB database. hourly_cleanup() now keeps one day of history,
-- enough to investigate a problem from yesterday.
-- =============================================================================
create or replace function public.hourly_cleanup()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rate integer;
  v_sms  integer;
  v_cron integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;
  delete from public.sms_log where created_at < now() - interval '30 days';
  get diagnostics v_sms = row_count;
  delete from cron.job_run_details where end_time < now() - interval '1 day';
  get diagnostics v_cron = row_count;
  return jsonb_build_object('rate_limits', v_rate, 'sms_log', v_sms, 'cron_history', v_cron);
end;
$$;
revoke all on function public.hourly_cleanup() from public, anon, authenticated;
