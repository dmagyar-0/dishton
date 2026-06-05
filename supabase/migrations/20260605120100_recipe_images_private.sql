-- 20260605120100_recipe_images_private.sql
-- Finding A (CRITICAL) — the recipe-images bucket was created public=true, so
-- the recipe_images_read storage RLS policy was dead and avatars stored at
-- `<uid>/avatar.*` were world-readable and enumerable. Flip the bucket to
-- private so all reads go through the storage RLS policies (member/follower of
-- the owning recipe, or the object's own `<uid>/...` folder). Objects we store
-- are now served via short-lived signed URLs minted in the SPA query layer.
--
-- The earlier migration's CREATE was patched to public=false for fresh
-- installs; this forward UPDATE fixes databases that already provisioned the
-- bucket as public.
--
-- Forward-only.

set search_path = public;

update storage.buckets
   set public = false
 where id = 'recipe-images';
