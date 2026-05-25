-- 20260524130000_import_jobs_background.sql
-- Background-mode imports: the edge function can keep working after the SPA
-- disconnects, and the SPA picks the completed draft up via Realtime when
-- it next becomes ready to save.
--
-- Schema changes:
--   1. New status 'awaiting_save' — terminal for the edge function, signals
--      to the SPA that payload.draft is ready and save_recipe must still be
--      called with the SPA's own JWT (keeps "edge functions never write to
--      app.recipes" intact and dodges JWT-expiry edge cases).
--   2. New phase column — surfaces what the worker is doing so the active-
--      imports indicator can render a meaningful label without polling.
--   3. progress_text column — short human-readable label (e.g. "Reading
--      page", "Asking the model", "Saving recipe").
--   4. completed_at trigger — set automatically on any transition into a
--      terminal status so writers can stop hand-setting it everywhere.
--   5. Realtime publication — needed for the SPA subscription. Idempotent
--      so the migration can re-run on environments where it already exists.
--   6. Bump reap_stuck_imports threshold from 4 to 5 minutes — background
--      imports legitimately run longer than the old 30 s inline budget.

set search_path = app, public;

------------------------------------------------------------------------------
-- 1. Status check + 2/3. New columns
------------------------------------------------------------------------------

alter table app.import_jobs
  drop constraint if exists import_jobs_status_check;
alter table app.import_jobs
  add constraint import_jobs_status_check
  check (status in ('queued', 'running', 'awaiting_save', 'needs_review', 'done', 'failed'));

alter table app.import_jobs
  add column if not exists phase text
  check (phase in ('scrape', 'ai', 'saving') or phase is null);

alter table app.import_jobs
  add column if not exists progress_text text;

-- Extend the running-rows partial index so awaiting_save also benefits from
-- index-only scans (the active-imports indicator queries on it).
drop index if exists app.import_jobs_running_idx;
create index import_jobs_running_idx
  on app.import_jobs (status)
  where status in ('queued', 'running', 'awaiting_save');

------------------------------------------------------------------------------
-- 4. completed_at trigger
------------------------------------------------------------------------------

create or replace function app.import_jobs_set_completed_at()
returns trigger
language plpgsql
set search_path = app, public
as $$
begin
  if new.status in ('done', 'failed', 'needs_review')
     and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists import_jobs_touch_completed on app.import_jobs;
create trigger import_jobs_touch_completed
  before insert or update on app.import_jobs
  for each row execute function app.import_jobs_set_completed_at();

------------------------------------------------------------------------------
-- 5. Realtime publication (idempotent)
------------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table app.import_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

------------------------------------------------------------------------------
-- 6. Reaper threshold bump
------------------------------------------------------------------------------

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
     and created_at < now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.reap_stuck_imports() from public, anon;
grant execute on function app.reap_stuck_imports() to authenticated, service_role;
