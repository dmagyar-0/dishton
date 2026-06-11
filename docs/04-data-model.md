# 04 — Data Model

## Purpose

Define the Postgres schema, row-level-security (RLS) policies, indexes, storage
buckets, migration policy, and seed data for Dishton. The schema is the contract
between the SPA, the Edge Functions, and the test harness — it must be unambiguous
and runnable as-is against a fresh Supabase Postgres 15+ database.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decisions (Households + Follows
  sharing, canonical recipe storage, AI rate budget).
- [01-architecture.md](./01-architecture.md) — process boundaries.

## Schema location

All app-owned tables live in the `app` schema. The `auth` schema is owned by
GoTrue and read only via the `auth.uid()` function. The `storage` schema is
owned by Supabase Storage; we configure it via the Supabase CLI (see
"Storage buckets" below).

```sql
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;
```

## Helper functions

```sql
create or replace function app.is_household_member(h uuid)
returns boolean language sql stable security definer set search_path = app, public
as $$
  select exists (
    select 1 from app.household_members
    where household_id = h and profile_id = auth.uid()
  );
$$;

create or replace function app.is_household_follower(h uuid)
returns boolean language sql stable security definer set search_path = app, public
as $$
  select exists (
    select 1
    from app.follows f
    join app.household_members hm
      on hm.household_id = f.follower_household_id
     and hm.profile_id = auth.uid()
    where f.followed_household_id = h
  );
$$;

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
```

## DDL

Migrations live under `/home/user/dishton/supabase/migrations/` and are named
`<UTC-timestamp>_<purpose>.sql` (e.g. `20260430120000_init.sql`). Forward-only;
no destructive edits without a follow-up migration. Bootstrap order:

1. `*_init.sql` — schema, helpers, profiles, households, members, follows.
2. `*_recipes.sql` — recipes and child tables, triggers, FTS.
3. `*_imports.sql` — import_jobs, ai_rate_budget.
4. `*_invites.sql` — household invites.
5. `*_translations.sql` — recipe_translations.
6. `*_storage.sql` — storage policies.

```sql
-- profiles (1:1 with auth.users)
create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  avatar_url text,
  locale text not null default 'en'
    check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  preferred_unit_system text not null default 'metric'
    check (preferred_unit_system in ('metric','imperial')),
  preferred_language text not null default 'en'
    check (preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated before update on app.profiles
  for each row execute function app.set_updated_at();

-- households
create table app.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  owner_profile_id uuid not null references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger households_set_updated before update on app.households
  for each row execute function app.set_updated_at();

create table app.household_members (
  household_id uuid not null references app.households(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  joined_at timestamptz not null default now(),
  primary key (household_id, profile_id)
);
create index on app.household_members (profile_id);

-- one-way follow: follower household sees followed household read-only
create table app.follows (
  follower_household_id uuid not null references app.households(id) on delete cascade,
  followed_household_id uuid not null references app.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_household_id, followed_household_id),
  check (follower_household_id <> followed_household_id)
);
create index on app.follows (followed_household_id);

-- household invites (single-use, 7-day expiry, base32-8 codes)
create table app.household_invites (
  code text primary key check (code ~ '^[A-Z2-7]{8}$'),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references app.profiles(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on app.household_invites (household_id) where redeemed_at is null;

-- recipes
create table app.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  title text not null check (length(title) between 1 and 200),
  description text,
  source_type text not null
    check (source_type in ('url','instagram','photo','manual')),
  source_url text,
  source_language text not null default 'en'
    check (source_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  canonical_unit_system text not null
    check (canonical_unit_system in ('metric','imperial')),
  servings integer not null check (servings between 1 and 200),
  total_time_min integer check (total_time_min >= 0),
  hero_image_path text,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on app.recipes (household_id);
create index on app.recipes (household_id, created_at desc);
create index on app.recipes using gin (search);
create trigger recipes_set_updated before update on app.recipes
  for each row execute function app.set_updated_at();

create table app.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  position integer not null,
  raw_text text not null,
  quantity numeric,
  unit text,
  ingredient_name text,
  notes text,
  unique (recipe_id, position)
);
create index on app.recipe_ingredients (recipe_id);

create table app.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  position integer not null,
  body text not null,
  duration_min integer check (duration_min >= 0),
  unique (recipe_id, position)
);
create index on app.recipe_steps (recipe_id);

create table app.recipe_tags (
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 40),
  primary key (recipe_id, tag)
);
create index on app.recipe_tags (tag);

-- AI translation cache
create table app.recipe_translations (
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  language text not null check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  payload jsonb not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  primary key (recipe_id, language)
);

-- import jobs (one row per import attempt)
create table app.import_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id),
  household_id uuid not null references app.households(id),
  kind text not null check (kind in ('url','instagram','photo','manual')),
  status text not null
    check (status in ('queued','running','needs_review','done','failed')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  recipe_id uuid references app.recipes(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on app.import_jobs (profile_id, created_at desc);
create index on app.import_jobs (status) where status in ('queued','running');

-- single-row token bucket for Anthropic rate budget
create table app.ai_rate_budget (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default now(),
  tokens_used bigint not null default 0,
  budget_per_minute bigint not null default 60000
);
insert into app.ai_rate_budget default values on conflict do nothing;
```

### FTS trigger

```sql
create or replace function app.recipes_search_refresh() returns trigger
language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
    || setweight(to_tsvector('simple',
        coalesce(
          (select string_agg(tag, ' ') from app.recipe_tags where recipe_id = new.id),
          '')), 'B')
    || setweight(to_tsvector('simple',
        coalesce(
          (select string_agg(coalesce(ingredient_name, raw_text), ' ')
             from app.recipe_ingredients where recipe_id = new.id),
          '')), 'C');
  return new;
end;
$$;

create trigger recipes_search_trg
  before insert or update on app.recipes
  for each row execute function app.recipes_search_refresh();

-- and refresh from child tables
create or replace function app.recipes_touch_for_search() returns trigger
language plpgsql as $$
begin
  update app.recipes set updated_at = now()
  where id = coalesce(new.recipe_id, old.recipe_id);
  return null;
end;
$$;

create trigger recipe_ingredients_touch
  after insert or update or delete on app.recipe_ingredients
  for each row execute function app.recipes_touch_for_search();
create trigger recipe_tags_touch
  after insert or update or delete on app.recipe_tags
  for each row execute function app.recipes_touch_for_search();
```

## RLS policies

Enable RLS on every `app.*` table:

```sql
alter table app.profiles            enable row level security;
alter table app.households          enable row level security;
alter table app.household_members   enable row level security;
alter table app.follows             enable row level security;
alter table app.household_invites   enable row level security;
alter table app.recipes             enable row level security;
alter table app.recipe_ingredients  enable row level security;
alter table app.recipe_steps        enable row level security;
alter table app.recipe_tags         enable row level security;
alter table app.recipe_translations enable row level security;
alter table app.import_jobs         enable row level security;
alter table app.ai_rate_budget      enable row level security;
```

Policy summary (full SQL is generated from the table; the next session writes it
inline in the migrations):

| Table | Policy | Rule |
|---|---|---|
| profiles | self read | `id = auth.uid()` |
| profiles | self update | same |
| households | member read | `app.is_household_member(id)` |
| households | follower read | `app.is_household_follower(id)` |
| households | owner update | `id in (select household_id from app.household_members where profile_id = auth.uid() and role = 'owner')` |
| household_members | self read | `profile_id = auth.uid()` |
| household_members | member read | `app.is_household_member(household_id)` |
| household_members | owner write | owner of the same household |
| follows | member read | follower or followed household member |
| follows | owner write | only owners of the follower household |
| household_invites | member read | members of the household |
| household_invites | member insert | members of the household |
| household_invites | redeemer update | any authenticated user, only fields `redeemed_by`, `redeemed_at` and only when `redeemed_at is null and expires_at > now()` |
| recipes | read | `app.is_household_member(household_id) or app.is_household_follower(household_id)` |
| recipes | write | `app.is_household_member(household_id) and role in ('owner','editor')` (see `household_members` join) |
| recipe_ingredients/steps/tags | read | recipe-scoped: `exists (select 1 from app.recipes r where r.id = recipe_id and (app.is_household_member(r.household_id) or app.is_household_follower(r.household_id)))` |
| recipe_ingredients/steps/tags | write | recipe-scoped member-only |
| recipe_translations | read | recipe-scoped (member or follower) |
| recipe_translations | write | service_role only (Edge Functions write via service role) |
| import_jobs | self only | `profile_id = auth.uid()` |
| ai_rate_budget | service_role only | RLS denies anon/authenticated; only Edge Functions touch it |

Concrete examples (the rest follow the same pattern):

```sql
create policy recipes_member_or_follower_read on app.recipes
  for select using (
    app.is_household_member(household_id)
    or app.is_household_follower(household_id)
  );

create policy recipes_member_write on app.recipes
  for all using (
    exists (
      select 1 from app.household_members hm
      where hm.household_id = recipes.household_id
        and hm.profile_id = auth.uid()
        and hm.role in ('owner','editor')
    )
  )
  with check (
    exists (
      select 1 from app.household_members hm
      where hm.household_id = recipes.household_id
        and hm.profile_id = auth.uid()
        and hm.role in ('owner','editor')
    )
  );

create policy import_jobs_self on app.import_jobs
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
```

## RPCs

Stable surface used by the SPA. Defined in a `*_rpcs.sql` migration.

```sql
-- Redeem an invite atomically.
create or replace function app.redeem_invite(p_code text)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare hh uuid;
begin
  update app.household_invites
     set redeemed_by = auth.uid(), redeemed_at = now()
   where code = p_code
     and redeemed_at is null
     and expires_at > now()
   returning household_id into hh;
  if hh is null then raise exception 'invalid_or_expired_invite'; end if;
  insert into app.household_members (household_id, profile_id, role)
  values (hh, auth.uid(), 'editor')
  on conflict do nothing;
  return hh;
end;
$$;

-- Generate a new invite code.
create or replace function app.create_invite(p_household uuid)
returns text language plpgsql security definer set search_path = app, public as $$
declare c text;
begin
  if not app.is_household_member(p_household) then
    raise exception 'not_household_member';
  end if;
  c := upper(substr(translate(encode(gen_random_bytes(8), 'base32'),
                              '01','OI'), 1, 8));
  insert into app.household_invites (code, household_id, created_by)
  values (c, p_household, auth.uid());
  return c;
end;
$$;

-- Search recipes scoped to a set of household ids.
create or replace function app.search_recipes(q text, household_ids uuid[])
returns setof app.recipes language sql stable as $$
  select r.* from app.recipes r
  where r.household_id = any(household_ids)
    and r.search @@ websearch_to_tsquery('simple', q)
  order by ts_rank(r.search, websearch_to_tsquery('simple', q)) desc, r.created_at desc
  limit 100;
$$;
```

## Storage buckets

Configure via Supabase CLI in `supabase/seed.sql` and `supabase/config.toml`:

| Bucket | Public | Max object | Allowed MIME |
|---|---|---|---|
| `recipe-images` | yes (signed URLs preferred) | 5 MB | `image/jpeg`, `image/png`, `image/webp`, `image/avif` |
| `imports` | no | 20 MB | `image/jpeg`, `image/png`, `image/webp`, `text/html` |

Policies:

```sql
-- recipe-images: read for member/follower of recipe's household; write for editor+.
create policy recipe_images_read on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'recipe-images'
    and exists (
      select 1 from app.recipes r
      where r.hero_image_path = name
        and (app.is_household_member(r.household_id)
             or app.is_household_follower(r.household_id))
    )
  );

create policy recipe_images_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- imports: only the uploader and service_role can read.
create policy imports_self on storage.objects
  for all to authenticated using (
    bucket_id = 'imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Object naming convention: `recipe-images/<uid>/<recipe-id>.<ext>` and
`imports/<uid>/<job-id>.<ext>`.

> Amendment (2026-06, migration `20260611120000_recipe_shares.sql`): the
> `recipe_images_read` policy now delegates to the SECURITY DEFINER helper
> `app.can_read_recipe_image(name)`. The inline subqueries above only work for
> roles holding a grant on `app.recipes`; anon has none, and the public share
> page reads storage through RLS as anon. The helper preserves the
> member/follower and own-folder branches and adds a third: any object that is
> the `hero_image_path` of a recipe with a live `app.recipe_shares` row.

## Public recipe shares (2026-06 addition)

Opt-in public links for single recipes (the sharing loop's landing surface;
spec: `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`).
Shipped in migration `20260611120000_recipe_shares.sql`.

```sql
create table app.recipe_shares (
  recipe_id  uuid primary key references app.recipes(id) on delete cascade,
  token      text not null unique default app.gen_share_token(), -- 32 hex chars
  created_by uuid references app.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
```

- Row exists ⇔ link is live; revoke = delete. Re-enabling generates a fresh
  token (no UPDATE policy). The 128-bit random token is the access secret.
- RLS: SELECT for household members (`recipe_shares_member_read`);
  INSERT/DELETE for recipe editors (`recipe_shares_editor_insert` /
  `recipe_shares_editor_delete`). No anon grant at all — followers and anon
  cannot enumerate share rows.
- The only anon read path is `app.get_public_recipe(share_token text)`:
  SECURITY DEFINER, executable by `anon`/`authenticated`/`service_role`,
  returning a whitelisted jsonb projection (recipe fields + ordered
  ingredients/steps + tags + `household_name`; no ids, no profiles, no
  timestamps). It returns `null` for unknown tokens and whenever the
  `feature_flags.public_recipe_shares` kill switch is off.
- Consumers: the SPA route `/r/$token` (anon supabase-js) and the
  `public-recipe` Edge Function (OG meta + card image for crawlers).

## Seed data (`supabase/seed.sql`)

```sql
-- Two profiles, one shared household, one followed household.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001','alice@example.test'),
  ('00000000-0000-0000-0000-000000000002','bob@example.test'),
  ('00000000-0000-0000-0000-000000000003','carol@example.test');

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-000000000001','Alice'),
  ('00000000-0000-0000-0000-000000000002','Bob'),
  ('00000000-0000-0000-0000-000000000003','Carol');

insert into app.households (id, name, owner_profile_id) values
  ('11111111-1111-1111-1111-111111111111','The Pantry','00000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222','Carol''s Kitchen','00000000-0000-0000-0000-000000000003');

insert into app.household_members (household_id, profile_id, role) values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001','owner'),
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002','editor'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000003','owner');

insert into app.follows values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', now());

-- Two sample recipes
insert into app.recipes (id, household_id, created_by, title, source_type,
  source_language, canonical_unit_system, servings, total_time_min) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Tomato Tarte Tatin','manual','en','metric',4,55),
  ('44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000003',
   'Limoncello','manual','it','metric',12,1440);
```

## Files this doc governs

- `/home/user/dishton/supabase/migrations/*.sql`
- `/home/user/dishton/supabase/seed.sql`
- `/home/user/dishton/supabase/config.toml` (storage buckets, project settings)
- `/home/user/dishton/supabase/tests/schema.test.sql`
- `/home/user/dishton/supabase/tests/rls.test.sql`

## Acceptance criteria

- [ ] `supabase db reset` followed by `supabase db push` applies cleanly with no
      warnings.
- [ ] All `app.*` tables have RLS enabled (verified by a `pgtap` assertion in
      [12-testing-strategy.md](./12-testing-strategy.md)).
- [ ] A non-member cannot SELECT or UPDATE another household's recipe (verified
      by `supabase/tests/rls.test.sql`).
- [ ] A follower can SELECT recipes from the followed household but UPDATE/DELETE
      returns zero rows (RLS-stripped).
- [ ] `app.search_recipes('tomato', '{...}')` returns the seeded "Tomato Tarte
      Tatin" row when the household id is included.
- [ ] `app.redeem_invite()` rejects expired or already-redeemed codes.
- [ ] Storage policy for `imports` denies SELECT to a profile other than the
      uploader.
- [ ] No emojis anywhere in this doc.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/04-data-model.md
grep -q "## Purpose"                docs/04-data-model.md
grep -q "## Prerequisites"          docs/04-data-model.md
grep -q "## Files this doc governs" docs/04-data-model.md
grep -q "## Acceptance criteria"    docs/04-data-model.md
grep -q "## Verification"           docs/04-data-model.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/04-data-model.md
# every promised table is named
for t in profiles households household_members follows household_invites \
         recipes recipe_ingredients recipe_steps recipe_tags \
         recipe_translations import_jobs ai_rate_budget; do
  grep -q "app\\.${t}" docs/04-data-model.md || echo "missing table: $t"
done
```

After the migrations are written:

```bash
supabase start
supabase db reset
psql "$LOCAL_DB_URL" -f supabase/seed.sql
pnpm test:db
```
