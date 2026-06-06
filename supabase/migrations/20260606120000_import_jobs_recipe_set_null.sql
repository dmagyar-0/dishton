-- Make app.import_jobs.recipe_id null out when its recipe is deleted.
--
-- import_jobs.recipe_id was created ON DELETE NO ACTION (the column in
-- 20260430120200_imports.sql carried no ON DELETE clause). Every recipe born
-- from an import keeps an import_jobs row pointing at it, so deleting such a
-- recipe via `delete from app.recipes` (the SPA's useDeleteRecipe path) was
-- rejected with:
--   ERROR: update or delete on table "recipes" violates foreign key
--   constraint "import_jobs_recipe_id_fkey" on table "import_jobs"
-- observed on prod 2026-06-06.
--
-- 20260524203620_import_jobs_cascade.sql fixed the sibling household_id FK but
-- left recipe_id untouched. import_jobs is an audit log of import *attempts*;
-- the row stays meaningful after its recipe is gone, so SET NULL (not CASCADE)
-- is the right semantics -- keep the log, drop the dangling pointer. recipe_id
-- is already nullable (it is null for every queued/running/failed job).

alter table app.import_jobs
  drop constraint import_jobs_recipe_id_fkey,
  add constraint import_jobs_recipe_id_fkey
    foreign key (recipe_id) references app.recipes(id) on delete set null;
