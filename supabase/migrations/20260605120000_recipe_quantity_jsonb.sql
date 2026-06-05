-- 20260605120000_recipe_quantity_jsonb.sql
-- Production-readiness fixes that all converge on the save_recipe / update_recipe
-- RPCs, so they ship together to avoid redefining the same functions twice:
--
--   * Decision 1 — store recipe_ingredients.quantity as jsonb, round-tripping
--     the domain `number | {numerator,denominator}` union faithfully instead of
--     collapsing fractions to a lossy numeric (1/2 -> 0.5). The FTS / scaling
--     code converts to a number at read time; nothing in the DB needs numeric.
--   * Finding E — enforce the household tag whitelist server-side. Incoming
--     tags are normalised (lower + trim) and intersected with the household's
--     allowed_tags; anything off-whitelist is dropped rather than inserted.
--   * Finding F — save_recipe now authorises via app.is_household_editor for
--     parity with the recipes table policy and update_recipe.
--   * Finding J — update_recipe takes an optimistic-concurrency token
--     (p_expected_updated_at). A mismatch raises `recipe_edit_conflict` so a
--     second editor cannot silently clobber the first editor's write.
--
-- Forward-only.

set search_path = public;

------------------------------------------------------------------------------
-- recipe_ingredients.quantity: numeric -> jsonb.
-- Existing numeric values become JSON numbers via to_jsonb; nulls stay null.
------------------------------------------------------------------------------

alter table app.recipe_ingredients
  alter column quantity type jsonb
  using to_jsonb(quantity);

------------------------------------------------------------------------------
-- app.normalize_quantity(q jsonb) -> jsonb
-- Canonicalises the stored quantity to the domain union: a JSON number, a
-- {numerator,denominator} object (denominator > 0), or null. String-form
-- scalars the AI occasionally emits ("0.25") collapse to a JSON number;
-- anything else becomes null. IMMUTABLE so it can be used in selects freely.
------------------------------------------------------------------------------

create or replace function app.normalize_quantity(q jsonb)
returns jsonb
language sql immutable as $$
  select case
    when q is null or jsonb_typeof(q) = 'null' then null
    when jsonb_typeof(q) = 'number' then q
    when jsonb_typeof(q) = 'string'
         and nullif(q #>> '{}', '') is not null
         and (q #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then to_jsonb((q #>> '{}')::numeric)
    when jsonb_typeof(q) = 'object'
         and jsonb_typeof(q->'numerator')   = 'number'
         and jsonb_typeof(q->'denominator') = 'number'
         and ((q->'denominator')::text)::numeric > 0
      then jsonb_build_object(
        'numerator', q->'numerator',
        'denominator', q->'denominator'
      )
    else null
  end
$$;

grant execute on function app.normalize_quantity(jsonb)
  to authenticated, anon, service_role;

------------------------------------------------------------------------------
-- app.filter_household_tags(p_household uuid, p_tags jsonb) -> text[]
-- Normalises each incoming tag (lower + trim, mirroring normalizeTag /
-- TAG_PATTERN in src/domain/default-tags.ts) and keeps only those present in
-- the household's allowed_tags whitelist. Off-whitelist or malformed tags are
-- silently dropped. SECURITY DEFINER so it can read allowed_tags regardless of
-- the caller's RLS visibility (the calling RPCs already gate authorisation).
------------------------------------------------------------------------------

create or replace function app.filter_household_tags(p_household uuid, p_tags jsonb)
returns text[]
language sql
stable
security definer
set search_path = app, public
as $$
  select coalesce(array_agg(distinct n.tag), array[]::text[])
  from jsonb_array_elements_text(coalesce(p_tags, '[]'::jsonb)) as raw(tag)
  cross join lateral (select lower(btrim(raw.tag)) as tag) as n
  where n.tag ~ '^[a-z0-9][a-z0-9 -]{0,39}$'
    and n.tag = any (
      select unnest(allowed_tags) from app.households where id = p_household
    )
$$;

grant execute on function app.filter_household_tags(uuid, jsonb) to authenticated;

------------------------------------------------------------------------------
-- app.save_recipe(p_household uuid, p_draft jsonb) returns uuid
-- Editor-gated (F), stores raw jsonb quantity (decision 1), whitelist-filters
-- tags (E).
------------------------------------------------------------------------------

create or replace function app.save_recipe(p_household uuid, p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not app.is_household_editor(p_household) then
    raise exception 'not_household_editor';
  end if;

  insert into app.recipes (
    household_id, created_by, title, description, source_type, source_url,
    source_language, canonical_unit_system, servings, total_time_min,
    hero_image_path
  ) values (
    p_household,
    auth.uid(),
    p_draft->>'title',
    p_draft->>'description',
    p_draft->>'source_type',
    p_draft->>'source_url',
    coalesce(p_draft->>'source_language', 'en'),
    p_draft->>'canonical_unit_system',
    (p_draft->>'servings')::int,
    nullif(p_draft->>'total_time_min', '')::int,
    p_draft->>'hero_image_path'
  )
  returning id into new_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    new_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    app.normalize_quantity(i.value->'quantity'),
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    new_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select new_id, t
  from unnest(app.filter_household_tags(p_household, p_draft->'tags')) as t
  on conflict do nothing;

  return new_id;
end;
$$;

revoke all on function app.save_recipe(uuid, jsonb) from public, anon;
grant execute on function app.save_recipe(uuid, jsonb) to authenticated;

------------------------------------------------------------------------------
-- app.update_recipe(p_id uuid, p_draft jsonb, p_expected_updated_at timestamptz)
-- Editor-gated, jsonb quantity, whitelist tags, plus optimistic-concurrency
-- guard (J). When p_expected_updated_at is non-null and does not match the
-- row's current updated_at, the function raises `recipe_edit_conflict` and
-- makes no change. Passing null skips the check (callers that don't yet thread
-- a token retain the previous last-write-wins behaviour).
------------------------------------------------------------------------------

create or replace function app.update_recipe(
  p_id uuid,
  p_draft jsonb,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
  hh uuid;
  current_updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select household_id, updated_at into hh, current_updated_at
  from app.recipes where id = p_id;
  if hh is null then
    raise exception 'recipe_not_found';
  end if;
  if not app.is_household_editor(hh) then
    raise exception 'not_household_editor';
  end if;

  if p_expected_updated_at is not null
     and current_updated_at is distinct from p_expected_updated_at then
    raise exception 'recipe_edit_conflict'
      using errcode = 'P0001';
  end if;

  update app.recipes set
    title                 = p_draft->>'title',
    description           = p_draft->>'description',
    source_type           = p_draft->>'source_type',
    source_url            = p_draft->>'source_url',
    source_language       = coalesce(p_draft->>'source_language', source_language),
    canonical_unit_system = p_draft->>'canonical_unit_system',
    servings              = (p_draft->>'servings')::int,
    total_time_min        = nullif(p_draft->>'total_time_min', '')::int,
    hero_image_path       = p_draft->>'hero_image_path',
    updated_at            = now()
  where id = p_id;

  delete from app.recipe_ingredients where recipe_id = p_id;
  delete from app.recipe_steps       where recipe_id = p_id;
  delete from app.recipe_tags        where recipe_id = p_id;
  delete from app.recipe_translations where recipe_id = p_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    p_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    app.normalize_quantity(i.value->'quantity'),
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    p_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select p_id, t
  from unnest(app.filter_household_tags(hh, p_draft->'tags')) as t
  on conflict do nothing;
end;
$$;

-- Drop the prior 2-arg signature so PostgREST resolves the new 3-arg form and
-- we don't leave a stale overload behind.
drop function if exists app.update_recipe(uuid, jsonb);

revoke all on function app.update_recipe(uuid, jsonb, timestamptz) from public, anon;
grant execute on function app.update_recipe(uuid, jsonb, timestamptz) to authenticated;
