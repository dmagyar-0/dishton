-- 20260430120900_storage_policies.sql
-- Storage RLS policies for the recipe-images and imports buckets.
-- Defined by docs/04-data-model.md. The buckets themselves are configured
-- in supabase/config.toml.

set search_path = public;

-- Ensure the buckets exist in case the config.toml-driven creation has not
-- run yet (e.g. when migrations are applied against a stock Postgres without
-- the Supabase storage stack initialised).
insert into storage.buckets (id, name, public)
  values ('recipe-images', 'recipe-images', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('imports', 'imports', false)
  on conflict (id) do nothing;

------------------------------------------------------------------------------
-- recipe-images
-- Read: members or followers of the recipe whose hero_image_path matches
--       the storage object name. Anonymous users get a signed-URL hand-off
--       from PostgREST so they don't hit this policy in the happy path.
-- Write: authenticated users may write only into their own folder
--        (recipe-images/<uid>/...). Avatars use the same convention.
------------------------------------------------------------------------------

drop policy if exists recipe_images_read on storage.objects;
create policy recipe_images_read on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'recipe-images'
    and (
      -- Avatars (recipe-images/<uid>/avatar.*) are readable by anyone with a
      -- valid signed URL; we allow direct reads only when an associated
      -- recipe row points at the object.
      exists (
        select 1 from app.recipes r
        where r.hero_image_path = storage.objects.name
          and (app.is_household_member(r.household_id)
               or app.is_household_follower(r.household_id))
      )
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists recipe_images_write on storage.objects;
create policy recipe_images_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists recipe_images_update on storage.objects;
create policy recipe_images_update on storage.objects
  for update to authenticated using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists recipe_images_delete on storage.objects;
create policy recipe_images_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

------------------------------------------------------------------------------
-- imports
-- All operations: only the uploader (whose UID is the first folder segment)
-- and the service role may touch these private objects.
------------------------------------------------------------------------------

drop policy if exists imports_self on storage.objects;
create policy imports_self on storage.objects
  for all to authenticated using (
    bucket_id = 'imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
