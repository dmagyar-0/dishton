-- Make app.import_jobs.recipe_id null out on recipe delete.
--
-- The original FK in 20260430120100_recipes.sql / 20260430120200_imports.sql
-- declared `recipe_id uuid references app.recipes(id)` with no ON DELETE
-- action, which Postgres defaults to NO ACTION. Once an import succeeds the
-- SPA patches the job row with `recipe_id = <new recipe>` (see
-- src/lib/imports/ActiveImportsProvider.tsx), so every imported recipe is
-- pinned by an import_jobs row and `DELETE FROM app.recipes` fails with
-- `import_jobs_recipe_id_fkey` -- recipes become undeletable for users.
--
-- The sibling FK on import_jobs.household_id was fixed in
-- 20260524203620_import_jobs_cascade.sql with ON DELETE CASCADE. Here we use
-- SET NULL instead: the household lives on after a recipe delete, and the
-- import-job log row (status, kind, payload, timestamps) still has audit
-- value once the recipe is gone -- we just lose the back-pointer. The
-- column is already nullable, so no data migration is needed.

alter table app.import_jobs
  drop constraint import_jobs_recipe_id_fkey,
  add constraint import_jobs_recipe_id_fkey
    foreign key (recipe_id) references app.recipes(id) on delete set null;
