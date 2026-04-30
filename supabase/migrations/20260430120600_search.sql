-- 20260430120600_search.sql
-- app.search_recipes(text, uuid[]) and app.popular_tags(uuid[], int).
-- Defined by docs/04-data-model.md and docs/10-search-and-tags.md.

set search_path = public;

------------------------------------------------------------------------------
-- app.search_recipes(q text, household_ids uuid[]) returns setof app.recipes
-- Plain SQL function (not security definer) so the calling user's RLS still
-- applies via the recipes table. The household_ids filter narrows the search;
-- RLS removes any household the caller cannot read.
------------------------------------------------------------------------------

create or replace function app.search_recipes(q text, household_ids uuid[])
returns setof app.recipes
language sql
stable
set search_path = app, public
as $$
  select r.*
  from app.recipes r
  where r.household_id = any(household_ids)
    and r.search @@ websearch_to_tsquery('simple', q)
  order by ts_rank(r.search, websearch_to_tsquery('simple', q)) desc,
           r.created_at desc
  limit 100;
$$;

revoke all on function app.search_recipes(text, uuid[]) from public, anon;
grant execute on function app.search_recipes(text, uuid[])
  to authenticated, service_role;

------------------------------------------------------------------------------
-- app.popular_tags(p_household_ids uuid[], p_limit int default 24)
-- Lists the most-used tags across the requested households. The join through
-- app.recipes ensures RLS strips inaccessible households automatically.
------------------------------------------------------------------------------

create or replace function app.popular_tags(p_household_ids uuid[], p_limit int default 24)
returns table(tag text, n bigint)
language sql
stable
set search_path = app, public
as $$
  select t.tag, count(*)::bigint as n
  from app.recipe_tags t
  join app.recipes r on r.id = t.recipe_id
  where r.household_id = any(p_household_ids)
  group by t.tag
  order by n desc, tag asc
  limit p_limit;
$$;

revoke all on function app.popular_tags(uuid[], int) from public, anon;
grant execute on function app.popular_tags(uuid[], int)
  to authenticated, service_role;
