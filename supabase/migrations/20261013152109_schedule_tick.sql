-- =============================================================================
-- Migration schedule_tick (M3): runs tick() every 10 seconds and
-- hourly_cleanup() every hour with pg_cron (ARCHITECTURE §8). Second-level
-- schedules were confirmed on the free plan in M0 (tools/platform-checks).
--
-- cron.schedule() with a job name replaces an existing job of that name, so
-- this is safe to re-run. Jobs run as the migration's role (postgres), which
-- owns tick() and hourly_cleanup().
-- To pause the timer (e.g. while investigating):  select cron.unschedule('introchat-tick');
-- Recent runs:  select * from cron.job_run_details order by start_time desc limit 20;
-- =============================================================================

select cron.schedule('introchat-tick', '10 seconds', 'select public.tick()');
select cron.schedule('introchat-hourly-cleanup', '7 * * * *', 'select public.hourly_cleanup()');
