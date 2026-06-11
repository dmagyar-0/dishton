-- 20260611120000_recipe_shares.sql
-- Opt-in public share links for single recipes.
-- Defined by docs/superpowers/specs/2026-06-11-public-recipe-share-design.md
-- and docs/04-data-model.md. The token is the access secret: 128-bit random,
-- hex-encoded. Row exists <=> link is live; revoke = delete the row.

set search_path = public;

-- pgcrypto lives in `extensions` on hosted Supabase but in `public` on the CI
-- stub; a schema-qualified wrapper (same trick as app.gen_base32) keeps the
-- column default working in both.
create or replace function app.gen_share_token()
returns text
language sql volatile
set search_path = public, extensions
as $$ select encode(gen_random_bytes(16), 'hex'); $$;

create table app.recipe_shares (
  recipe_id  uuid primary key references app.recipes(id) on delete cascade,
  token      text not null unique default app.gen_share_token(),
  created_by uuid references app.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table app.recipe_shares enable row level security;

-- Members see share status for their household's recipes. Followers and anon
-- see nothing — the token itself is the only public handle.
create policy recipe_shares_member_read on app.recipe_shares
  for select using (
    exists (
      select 1 from app.recipes r
      where r.id = recipe_id and app.is_household_member(r.household_id)
    )
  );

create policy recipe_shares_editor_insert on app.recipe_shares
  for insert with check (app.is_recipe_editor(recipe_id));

create policy recipe_shares_editor_delete on app.recipe_shares
  for delete using (app.is_recipe_editor(recipe_id));

-- No UPDATE policy: toggling re-creates the row (fresh token).
grant select, insert, delete on app.recipe_shares to authenticated;

------------------------------------------------------------------------------
-- Public read path. SECURITY DEFINER so anon can read exactly this whitelisted
-- projection and nothing else. Returns null for unknown tokens and when the
-- public_recipe_shares kill switch is off.
------------------------------------------------------------------------------

create or replace function app.get_public_recipe(share_token text)
returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare
  v_recipe_id uuid;
  v_enabled boolean;
  result jsonb;
begin
  select enabled into v_enabled
    from app.feature_flags where key = 'public_recipe_shares';
  if not coalesce(v_enabled, false) then return null; end if;

  select recipe_id into v_recipe_id
    from app.recipe_shares where token = share_token;
  if v_recipe_id is null then return null; end if;

  select jsonb_build_object(
    'recipe', jsonb_build_object(
      'title', r.title,
      'description', r.description,
      'source_type', r.source_type,
      'source_url', r.source_url,
      'source_language', r.source_language,
      'canonical_unit_system', r.canonical_unit_system,
      'servings', r.servings,
      'total_time_min', r.total_time_min,
      'hero_image_path', r.hero_image_path,
      'tags', coalesce(
        (select jsonb_agg(t.tag order by t.tag)
           from app.recipe_tags t where t.recipe_id = r.id),
        '[]'::jsonb),
      'ingredients', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'position', i.position,
            'raw_text', i.raw_text,
            'quantity', i.quantity,
            'unit', i.unit,
            'ingredient_name', i.ingredient_name,
            'notes', i.notes,
            'section', i.section) order by i.position)
           from app.recipe_ingredients i where i.recipe_id = r.id),
        '[]'::jsonb),
      'steps', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'position', s.position,
            'body', s.body,
            'duration_min', s.duration_min) order by s.position)
           from app.recipe_steps s where s.recipe_id = r.id),
        '[]'::jsonb)
    ),
    'household_name', h.name
  ) into result
  from app.recipes r
  join app.households h on h.id = r.household_id
  where r.id = v_recipe_id;

  return result;
end;
$$;

revoke all on function app.get_public_recipe(text) from public;
grant execute on function app.get_public_recipe(text)
  to anon, authenticated, service_role;

------------------------------------------------------------------------------
-- Storage: let anyone holding a live share link load the hero image. The
-- bucket stays private. The previous policy inlined subqueries on app.recipes,
-- which only works for roles with a grant on that table — anon has none (its
-- happy path was signed URLs, which bypass RLS). Public share views hit RLS
-- directly as anon, so the whole predicate moves into a SECURITY DEFINER
-- helper (the same pattern as app.is_household_member). Branches are
-- unchanged from 20260430120900_storage_policies.sql plus the share branch.
------------------------------------------------------------------------------

create or replace function app.can_read_recipe_image(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
begin
  -- Own folder: uploads and avatars under recipe-images/<uid>/...
  if (storage.foldername(p_name))[1] = auth.uid()::text then
    return true;
  end if;
  -- Member or follower of the household whose recipe points at this object.
  if exists (
    select 1 from app.recipes r
    where r.hero_image_path = p_name
      and (app.is_household_member(r.household_id)
           or app.is_household_follower(r.household_id))
  ) then
    return true;
  end if;
  -- Anyone, while a live public share points at the recipe.
  return exists (
    select 1 from app.recipes r
    join app.recipe_shares s on s.recipe_id = r.id
    where r.hero_image_path = p_name
  );
end;
$$;

revoke all on function app.can_read_recipe_image(text) from public;
grant execute on function app.can_read_recipe_image(text)
  to anon, authenticated, service_role;

drop policy if exists recipe_images_read on storage.objects;
create policy recipe_images_read on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'recipe-images' and app.can_read_recipe_image(name)
  );

------------------------------------------------------------------------------
-- Kill-switch flag (runtime, per docs/15-roadmap-and-flags.md). Enabled by
-- default: the feature is opt-in per recipe; the flag exists to turn the
-- public surface off in one update without deleting share rows.
------------------------------------------------------------------------------

insert into app.feature_flags (key, enabled, rollout_percent)
values ('public_recipe_shares', true, 100)
on conflict (key) do nothing;
