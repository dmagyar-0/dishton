-- 20260626120000_search_prefix.sql
-- Prefix-matching upgrade for app.search_recipes(text, uuid[]).
--
-- The original definition (20260430120600_search.sql) used
-- websearch_to_tsquery('simple', q), which only matches whole lexemes. A query
-- like "aub" would therefore never match a recipe containing "aubergine".
--
-- This migration replaces the function so that each whitespace-separated token
-- in the user query becomes a PREFIX term (lexeme:*) AND-ed together. So:
--   "aub"        -> aub:*
--   "thai green" -> thai:* & green:*
-- which makes partial-word searches behave the way users expect.
--
-- Safety: the user query is never interpolated into a tsquery string as-is.
-- We tokenize on whitespace and wrap each token as a single-quoted tsquery
-- lexeme (doubling any embedded single quotes) before appending ':*'. Inside a
-- quoted lexeme, tsquery operators (& | ! ( ) : * \ " <->) are treated as
-- literal text rather than operators, so to_tsquery cannot be broken or made to
-- raise. Quoting (rather than stripping non-alphanumerics) preserves accents
-- and non-Latin scripts, which the 'simple' tsvector config keeps verbatim
-- (e.g. café, piñata, борщ) -- stripping those characters would make such
-- recipes unsearchable. The quoted terms are joined with ' & ' and parsed once
-- with to_tsquery('simple', ...). If there are no tokens, the function returns
-- no rows.
--
-- Everything else is preserved: still a plain (security-invoker) SQL function
-- so the caller's RLS on app.recipes applies, still stable, same search_path,
-- same household_id = any(household_ids) filter, same ranking + limit.

set search_path = public;

create or replace function app.search_recipes(q text, household_ids uuid[])
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
    and r.household_id = any(household_ids)
    and r.search @@ tsq.query
  order by ts_rank(r.search, tsq.query) desc,
           r.created_at desc
  limit 100;
$$;

revoke all on function app.search_recipes(text, uuid[]) from public, anon;
grant execute on function app.search_recipes(text, uuid[])
  to authenticated, service_role;
