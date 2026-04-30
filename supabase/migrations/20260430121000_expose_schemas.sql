-- 20260430121000_expose_schemas.sql
-- Expose the `app` schema (alongside the defaults) to PostgREST.
--
-- Every domain table lives under `app` (see 20260430120000_init.sql) and the
-- SPA client opts into it via `db: { schema: 'app' }` in src/lib/supabase.ts.
-- Locally, supabase/config.toml's `[api].schemas` propagates the list to
-- PostgREST. On hosted Supabase that list is stored as a GUC on the
-- `authenticator` role, so a freshly linked project rejects every SPA call
-- with "Invalid schema: app" until the dashboard's "Exposed schemas" toggle
-- is flipped. Apply the GUC from a migration so the linkage is self-healing
-- and the first deploy of a new project just works.
--
-- The list mirrors supabase/config.toml; keep them in sync.

set search_path = public;

alter role authenticator set pgrst.db_schemas = 'public, app, storage, graphql_public';
notify pgrst, 'reload config';
