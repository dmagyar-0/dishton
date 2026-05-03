-- 20260503120000_imports_reaper.sql
-- Reaper for stuck import_jobs rows.
--
-- Edge functions run the import inline. When the runtime hard-kills the
-- worker (wall-clock cap, OOM, client disconnect, shutdown) the JS catch
-- block never runs, so the row sits at status='running' forever. That row
-- counts toward the per-profile concurrency cap, so two stuck rows wedge
-- the user out of imports entirely.
--
-- This function is the DB-side fallback. Each import edge function calls
-- it before checking the cap; the function flips any of the caller's own
-- running rows older than 4 minutes (well past the inline 30s budget) to
-- failed/timeout. RLS scopes the update to the caller, so the function is
-- SECURITY INVOKER and safe to grant to authenticated.

set search_path = app, public;

create or replace function app.reap_stuck_imports()
returns int
language plpgsql
set search_path = app, public
as $$
declare n int;
begin
  update app.import_jobs
     set status = 'failed',
         error = 'timeout',
         completed_at = now()
   where status = 'running'
     and created_at < now() - interval '4 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.reap_stuck_imports() from public, anon;
grant execute on function app.reap_stuck_imports() to authenticated, service_role;
