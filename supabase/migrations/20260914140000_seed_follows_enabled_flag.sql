-- 20260914140000_seed_follows_enabled_flag.sql
-- Ship the `follows_enabled` runtime flag row.
--
-- app.feature_flags is created empty (20260430120700) and each flagged feature
-- inserts its own row when it ships -- see 20260611120000_recipe_shares.sql,
-- which adds `public_recipe_shares` with the same shape. `follows_enabled`
-- never got that migration: it exists in src/feature-flags/registry.ts and in
-- docs/15-roadmap-and-flags.md, but the only place the ROW was ever created is
-- supabase/seed.sql -- which runs on a local `supabase db reset` and never
-- against a deployed project.
--
-- useFeatureFlag reads the row with .maybeSingle() and treats a missing row as
-- false, so in production the flag has been off since follows shipped. That
-- silently dark-shipped the whole "save a followed household's recipe" surface
-- (#136 and #166): browsingFollowed / canSaveLink / linksEnabled all AND with
-- this flag, so no save control rendered on a followed household's cards or on
-- a followed recipe's page, saved links were never merged into the owner's
-- list, and search never passed include_links.
--
-- The local seed masked it completely: every unit, DB and E2E test, and every
-- local visual validation, ran against a database where seed.sql had set the
-- flag true.
--
-- Enabled by default, matching the recipe-shares precedent: follows are already
-- in use in production (households follow each other and can browse each
-- other's recipes today), so this completes a feature that is already half
-- live rather than turning on something new. The flag stays as the kill switch.
--
-- `on conflict do nothing` so environments that already carry the row -- local
-- databases seeded from seed.sql, and any project where it was set by hand --
-- keep whatever value they have instead of being forced back on.

-- public_household_pages is inserted too, explicitly OFF. It is a v2
-- placeholder that has always relied on "no row means false", which is exactly
-- the implicit state that hid this bug. Storing it makes every runtime flag a
-- real, inspectable row and lets scripts/check-flag-registry.mjs enforce that
-- invariant, so the next flagged feature cannot ship dark the same way.

set search_path = public;

insert into app.feature_flags (key, enabled, rollout_percent)
values
  ('follows_enabled', true, 100),
  ('public_household_pages', false, 0)
on conflict (key) do nothing;
