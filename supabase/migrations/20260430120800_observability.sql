-- 20260430120800_observability.sql
-- app.v_ai_daily_cost view per docs/14-observability.md.

set search_path = public;

------------------------------------------------------------------------------
-- View: aggregates per-day, per-household NIM token usage from import_jobs.
-- The view is exposed via PostgREST and read by /admin/cost.
------------------------------------------------------------------------------

create or replace view app.v_ai_daily_cost
with (security_invoker = true) as
select
  date_trunc('day', completed_at)::date            as day,
  household_id,
  count(*)                                         as jobs,
  coalesce(sum((payload->>'tokens_in')::bigint),  0) as tokens_in,
  coalesce(sum((payload->>'tokens_out')::bigint), 0) as tokens_out,
  coalesce(sum((payload->>'tokens_in')::bigint
             + (payload->>'tokens_out')::bigint), 0) as tokens_total
from app.import_jobs
where status = 'done'
group by 1, 2;

------------------------------------------------------------------------------
-- RLS: only owners of the household see rows. The view is security_invoker,
-- so the underlying import_jobs RLS still applies; but `import_jobs.profile_id
-- = auth.uid()` is too restrictive (an owner needs to see all jobs in their
-- household). We solve this with a row-level policy on a wrapper table-valued
-- function that owners can query, but for a view the simplest solution is a
-- secure wrapper function. We expose that here as v_ai_daily_cost_for_owner
-- and document the view as direct-query-only via service role.
--
-- For the SPA admin panel we provide an owner-scoped helper that returns
-- the aggregated rows for a given household when the caller is an owner.
------------------------------------------------------------------------------

create or replace function app.v_ai_daily_cost_for_household(p_household uuid)
returns table(
  day date,
  household_id uuid,
  jobs bigint,
  tokens_in bigint,
  tokens_out bigint,
  tokens_total bigint
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not exists (
    select 1 from app.household_members hm
    where hm.household_id = p_household
      and hm.profile_id = auth.uid()
      and hm.role = 'owner'
  ) then
    raise exception 'not_household_owner';
  end if;

  return query
    select
      date_trunc('day', j.completed_at)::date          as day,
      j.household_id,
      count(*)::bigint                                  as jobs,
      coalesce(sum((j.payload->>'tokens_in')::bigint),  0)::bigint as tokens_in,
      coalesce(sum((j.payload->>'tokens_out')::bigint), 0)::bigint as tokens_out,
      coalesce(sum((j.payload->>'tokens_in')::bigint
                 + (j.payload->>'tokens_out')::bigint), 0)::bigint as tokens_total
    from app.import_jobs j
    where j.status = 'done'
      and j.household_id = p_household
    group by 1, 2
    order by 1 desc;
end;
$$;

revoke all on function app.v_ai_daily_cost_for_household(uuid) from public, anon;
grant execute on function app.v_ai_daily_cost_for_household(uuid) to authenticated;

-- The base view is granted to service_role only so PostgREST does not surface
-- it to authenticated users (who would see only their own jobs anyway via
-- import_jobs RLS, but we keep the surface minimal).
revoke all on app.v_ai_daily_cost from public, anon, authenticated;
grant select on app.v_ai_daily_cost to service_role;
