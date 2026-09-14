-- 20260914120000_search_includes_links.sql
-- Make app.search_recipes see "save to pantry" links (20260614130000).
--
-- Until now search filtered strictly on `r.household_id = any(household_ids)`,
-- so a recipe saved from a followed household was invisible to text search even
-- though it sat in the list and tag filtering DID find it: filter by "dessert"
-- and the saved recipe appeared, type "limoncello" and it vanished. Deferred as
-- out-of-scope in the v1 pantry-links spec; this closes it.
--
-- The link branch is opt-in via `include_links` (default false) so search keeps
-- matching what the list actually shows. The home page merges links only when
-- the viewer is a MEMBER of the household; when browsing a followed household
-- you see that household's own recipes and not the links IT has saved, so the
-- caller passes false there and search stays consistent with the browse list.
--
-- Still plain SQL (security invoker), so the caller's RLS on app.recipes and
-- app.recipe_links applies unchanged -- the link branch cannot widen what a
-- caller may read, only which of the readable rows are considered. Prefix
-- tokenisation and its quoting/safety notes are carried over verbatim from
-- 20260626120000_search_prefix.sql.

set search_path = public;

-- Replacing a 2-arg function with a 3-arg one whose extra argument has a
-- default: drop the old signature first, or both resolve and PostgREST sees an
-- ambiguous overload for a 2-arg call.
drop function if exists app.search_recipes(text, uuid[]);

create or replace function app.search_recipes(
  q text,
  household_ids uuid[],
  include_links boolean default false
)
returns setof app.recipes
language sql
stable
set search_path = app, public
as $$
  with tsq as (
    -- Build a prefix tsquery: quote each token as a lexeme, suffix ':*', AND.
    select to_tsquery(
             'simple',
             string_agg('''' || replace(tok, '''', '''''') || ''':*', ' & ')
           ) as query
    from regexp_split_to_table(lower(trim(coalesce(q, ''))), '\s+') as tok
    where tok <> ''
  )
  select r.*
  from app.recipes r, tsq
  where tsq.query is not null
    and r.search @@ tsq.query
    and (
      r.household_id = any(household_ids)
      or (
        include_links
        and exists (
          select 1
          from app.recipe_links l
          where l.recipe_id = r.id
            and l.household_id = any(household_ids)
        )
      )
    )
  order by ts_rank(r.search, tsq.query) desc,
           r.created_at desc
  limit 100;
$$;

revoke all on function app.search_recipes(text, uuid[], boolean) from public, anon;
grant execute on function app.search_recipes(text, uuid[], boolean)
  to authenticated, service_role;
