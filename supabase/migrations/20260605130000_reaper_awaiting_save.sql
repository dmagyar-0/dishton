-- 20260605130000_reaper_awaiting_save.sql
-- Extend app.reap_stuck_imports() to also expire orphaned 'awaiting_save' rows
-- and widen the 'running' threshold so it comfortably clears the worst-case
-- worker wall-clock budget.
--
-- Background-mode imports finish by writing status='awaiting_save'; the SPA's
-- Realtime listener then calls save_recipe and flips the row to 'done'. If the
-- tab that owns the import closes before the listener fires (and no other tab
-- backfills it), the row sits at 'awaiting_save' forever AND counts against the
-- per-profile concurrency cap (the cap query includes 'awaiting_save'). That
-- wedges the user out of imports.
--
-- Two changes here:
--   1. 'running' threshold 5 min -> 10 min. The AI client retries up to 3x at
--      90s/attempt with 1+2+4s backoff (~277s ~= 4.6 min worst case) plus
--      scrape/save overhead; 5 min could reap a still-working background job.
--      10 min leaves comfortable headroom while still freeing a truly stuck row
--      within a couple of minutes of the worst case.
--   2. 'awaiting_save' rows older than 30 min are expired to 'failed' with
--      error='abandoned'. 30 min is generous: a live tab re-drives them within
--      seconds via Realtime or the on-mount backfill, so only genuinely
--      abandoned drafts are reaped. The original draft lives in payload.draft,
--      so nothing the model produced is lost server-side — the user can re-run
--      the import.

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
         error = case when status = 'awaiting_save' then 'abandoned' else 'timeout' end,
         completed_at = now()
   where (status = 'running' and created_at < now() - interval '10 minutes')
      or (status = 'awaiting_save' and created_at < now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.reap_stuck_imports() from public, anon;
grant execute on function app.reap_stuck_imports() to authenticated, service_role;
