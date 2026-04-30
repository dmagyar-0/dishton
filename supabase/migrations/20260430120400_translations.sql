-- 20260430120400_translations.sql
-- recipe_translations cache table. Defined by docs/04-data-model.md.

set search_path = public;

create table app.recipe_translations (
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  language text not null check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  payload jsonb not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  primary key (recipe_id, language)
);

alter table app.recipe_translations enable row level security;

-- Read: same membership/follower rule as the parent recipe.
create policy recipe_translations_read on app.recipe_translations
  for select using (app.is_recipe_visible(recipe_id));

-- Writes are service_role only. The Edge Function `translate-recipe` uses the
-- service role to upsert translations after a NIM call. Authenticated users
-- never write here directly. Service role bypasses RLS, so no explicit
-- write policy is required - by omitting any FOR INSERT/UPDATE/DELETE policy
-- under RLS we deny those operations to anon/authenticated.

grant select on app.recipe_translations to authenticated, anon;
grant insert, update, delete on app.recipe_translations to service_role;
