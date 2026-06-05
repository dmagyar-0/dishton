-- supabase/perf/search.sql
-- Minimal performance harness for app.search_recipes, per the budget in
-- docs/10-search-and-tags.md (p95 < 150 ms for <= 5 000 recipes per household,
-- query length <= 40 chars).
--
-- This file is intentionally NOT a *.test.sql persona check — it is a manual
-- benchmark seed + pgbench script, kept minimal. The full 200-query soak
-- referenced in docs/10 is a follow-up; this version seeds a single benchmark
-- household with 5 000 recipes and runs search_recipes via pgbench so the p95
-- can be observed locally.
--
-- Usage (against a local stack):
--   psql "$LOCAL_DB_URL" -f supabase/perf/search.sql            # seed
--   pgbench "$LOCAL_DB_URL" -n -T 30 -f supabase/perf/search.bench.sql
--
-- The seed block is idempotent on the fixed benchmark household id below.

set search_path = app, public;

do $$
declare
  bench_owner constant uuid := 'ffffffff-0000-0000-0000-0000000000aa';
  bench_house constant uuid := 'ffffffff-0000-0000-0000-0000000000bb';
  i int;
begin
  -- Owner profile + household. We skip auth.users here (perf seed runs as a
  -- privileged role; RLS is exercised by the *.test.sql checks, not here).
  insert into app.profiles (id, display_name)
  values (bench_owner, 'Perf Owner')
  on conflict (id) do nothing;

  insert into app.households (id, name, owner_profile_id)
  values (bench_house, 'Perf Household', bench_owner)
  on conflict (id) do nothing;

  insert into app.household_members (household_id, profile_id, role)
  values (bench_house, bench_owner, 'owner')
  on conflict do nothing;

  -- Seed 5 000 recipes only if not already present, so re-running is cheap.
  if (select count(*) from app.recipes where household_id = bench_house) < 5000 then
    for i in 1..5000 loop
      insert into app.recipes (household_id, created_by, title, source_type,
                               source_language, canonical_unit_system, servings)
      values (bench_house, bench_owner,
              'Benchmark recipe ' || i || ' tomato basil soup',
              'manual', 'en', 'metric', 4);
    end loop;
  end if;
end $$;

-- Sanity: the search returns rows for the seeded household.
select count(*) > 0 as ok
from app.search_recipes(
  'tomato',
  array['ffffffff-0000-0000-0000-0000000000bb']::uuid[]
);
