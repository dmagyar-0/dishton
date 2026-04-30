# 15 — Roadmap and Feature Flags

## Purpose

Lock the staged roadmap (MVP / v1 / v2 — phases, not dates), enumerate every
feature flag the codebase ships with, and describe how each flag is flipped
(build-time env var vs runtime row in `app.feature_flags`). Each flag has a
default value per environment, an owner doc, and a removal criterion, so the
codebase does not accumulate dead branches. This doc is the single source of
truth for "what is built", "what is wired but off", and "what is not yet
written".

## Prerequisites

- [00-overview.md](./00-overview.md) — locked product scope.
- [04-data-model.md](./04-data-model.md) — owns the `feature_flags` table
  shape; this doc fixes the rows it must contain.
- [05-auth-and-households.md](./05-auth-and-households.md) — Google OAuth
  wiring is gated by a flag here.
- [08-import-pipelines.md](./08-import-pipelines.md) — Instagram and photo
  import are gated by flags here.
- [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md) — env-var
  flag values per environment.

## Phases at a glance

This is a phase order, not a calendar.

```
MVP ──────────► v1 ──────────► v2
email auth     Google OAuth   native mobile (RN)
households     IG import      grocery export
URL import     photo import   weekly meal plan
manual entry   AI translation expanded sharing roles
view + scale   household      public household pages
unit toggle    follow
```

A feature is "in" a phase only if it is buildable end-to-end in that phase
without forward-referencing a later phase's data shape.

## MVP

Scope (must all ship together; the app is not "done" until every line is
true):

1. **Email auth.** `signup`, `login`, `logout`, session restore, password
   reset. Owner: [05-auth-and-households.md](./05-auth-and-households.md).
2. **Households.** Create household on first run, invite by code, accept
   invite, list members, leave household. Owner: same.
3. **URL import.** Paste URL → readability extract → NIM → draft review →
   save. Owner: [08-import-pipelines.md](./08-import-pipelines.md).
4. **Manual entry.** Always-available recipe form using the canonical
   schema. Owner: [09-recipe-views.md](./09-recipe-views.md).
5. **Recipe view.** Hero, ingredients, steps, timings, servings.
6. **Scale.** Multiplier and target servings, with fraction rounding.
   Owner: [06-recipe-domain.md](./06-recipe-domain.md).
7. **Unit toggle.** Per-user default + per-recipe override sticky in URL
   search params.
8. **Editorial Pantry visual system.** No UI ships in any other style.
   Owner: [03-design-system.md](./03-design-system.md).
9. **Test pyramid.** Domain coverage at 90%, smoke E2E green. Owner:
   [12-testing-strategy.md](./12-testing-strategy.md).

Out of MVP (explicitly): Google OAuth, Instagram import, photo import,
language translation, follows. Each has a flag below; the flag is `false`
by default at MVP.

## v1

Adds (one PR can ship one of these without the others, but the phase is
"done" when all are on):

1. **Google OAuth.** Wired in MVP, behind `VITE_FEATURE_GOOGLE_AUTH`.
   Flipping requires:
   - Setting Supabase Authentication → Google to `enabled` with the
     project's client ID/secret.
   - Setting `VITE_FEATURE_GOOGLE_AUTH=true` in Vercel for the target
     environment.
   No code change, no migration.
2. **Instagram import.** Flag `VITE_FEATURE_INSTAGRAM_IMPORT`. Backend
   function `import-instagram` is deployed in MVP but the SPA tab is
   hidden behind the flag.
3. **Photo import.** Flag `VITE_FEATURE_PHOTO_IMPORT`. Same shape: Edge
   Function shipped, UI gated.
4. **Recipe translation.** Flag `VITE_FEATURE_TRANSLATION_CACHE` controls
   whether the language toggle exposes non-source languages and whether
   the SPA reads/writes `recipe_translations`. Owner:
   [06-recipe-domain.md](./06-recipe-domain.md) +
   [07-ai-integration.md](./07-ai-integration.md).
5. **Following households.** Public household pages stay v2; following an
   already-known household is v1. Adds the `follows` table writes/reads
   guarded by a runtime flag (`feature_flags.follows_enabled`). The table
   itself ships in MVP as part of doc 04 to avoid a destructive
   migration later.

## v2

Deferred. Each item below requires more than a flag flip — they need
non-trivial code, design, and (in some cases) a separate runtime.

1. **Native mobile app.** React Native (Expo). Reuses `src/domain/*`
   verbatim (the domain layer is intentionally framework-free per
   [06-recipe-domain.md](./06-recipe-domain.md)). New repository or
   package, not the same Vite project.
2. **Grocery-list export.** A new `grocery_lists` table + an export view
   (`.txt`, `.pdf`, share-sheet target). Owner: TBD doc; not yet
   written.
3. **Weekly meal plan.** A `meal_plans` table keyed by household and ISO
   week; UI for drag-arranging recipes into days.
4. **Sharing roles beyond owner/editor.** Adds `viewer` and `cook` roles.
   Requires re-issuing every RLS policy in [04-data-model.md](./04-data-model.md);
   destructive in spirit, so the v2 PR includes the
   forward + cleanup pair per the migration policy in
   [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).
5. **Public household pages.** `/h/<slug>` viewable without auth. Adds a
   `households.public_slug` column and a permissive RLS branch keyed
   on it.

These are off-limits to MVP and v1 sessions. If a session finds itself
"just adding a tiny piece" of a v2 feature, the answer is to update this
doc first, not to ship the change.

## Feature flag inventory

Two flag transports:

- **Build-time** — env var read by Vite via `import.meta.env`. Flipping
  requires a redeploy. Use this for flags that gate **routes**, **bundle
  weight**, or **third-party SDKs** that should not load when off.
- **Runtime** — row in `app.feature_flags`. Flipping is a single SQL
  update, no redeploy. Use this for flags that gate **server-mediated
  behaviour** (e.g. allow-following) or **per-household experiments**.

A flag is one or the other, never both. The table below names every flag
the codebase ships with at MVP.

| Flag | Transport | Default `local` | Default `preview` | Default `production` (MVP) | Default `production` (v1) | Owner doc | Removed when |
|---|---|---|---|---|---|---|---|
| `VITE_FEATURE_GOOGLE_AUTH` | build-time | `false` | `true` | `false` | `true` | [05](./05-auth-and-households.md) | Google login is GA in production for 30 days with no rollback |
| `VITE_FEATURE_INSTAGRAM_IMPORT` | build-time | `true` | `true` | `false` | `true` | [08](./08-import-pipelines.md) | IG import is on in production for 30 days |
| `VITE_FEATURE_PHOTO_IMPORT` | build-time | `true` | `true` | `false` | `true` | [08](./08-import-pipelines.md) | Photo import is on in production for 30 days |
| `VITE_FEATURE_TRANSLATION_CACHE` | build-time | `true` | `true` | `false` | `true` | [06](./06-recipe-domain.md) + [07](./07-ai-integration.md) | Translation toggle is on in production for 30 days |
| `feature_flags.follows_enabled` | runtime | `true` | `true` | `false` | `true` | [05](./05-auth-and-households.md) | Following has been on in production for 30 days |
| `feature_flags.public_household_pages` | runtime | `false` | `false` | `false` | `false` | [15](./15-roadmap-and-flags.md) (this doc) | v2 ships |

Conventions:

- Build-time flags default to **off** in `production` until their phase
  ships. They default to **on** in `preview` so PR previews always
  exercise the feature.
- Runtime flags live in `app.feature_flags` with the schema fixed in
  [04-data-model.md](./04-data-model.md):
  `(key text primary key, enabled bool not null default false,
  rollout_percent int not null default 0,
  updated_at timestamptz not null default now())`.
- The SPA reads runtime flags via a single TanStack Query hook
  `useFeatureFlag('key')` that subscribes to a Realtime channel for
  `app.feature_flags` so flips propagate without reload.
- Every flag has a `// FLAG: <name>` comment in code where it gates
  behaviour. CI greps for orphaned flags (referenced in code but missing
  from this table) and orphaned table rows (in `feature_flags` but
  missing from the table) and fails on either.

## Migration considerations between phases

Going **MVP → v1**:

- `VITE_FEATURE_GOOGLE_AUTH=true` requires the matching Supabase
  Authentication provider config (client ID + secret) to be in place
  *first*. The flag has no effect until both are true. Order in the
  rollout: provider config → flag flip → smoke test on a single
  household → broaden.
- Instagram and photo import flips are pure UI — the Edge Functions
  already exist. Before flipping, confirm
  [14-observability.md](./14-observability.md)'s Logtail saved queries
  cover the new flow; otherwise the SLO breach alerts won't fire on day
  one.
- Translation cache: enabling this triples the storage written to
  `recipe_translations`. Confirm Supabase project storage quota is at
  least 1 GB free before the flip.
- Follows: the `follows` table already exists from MVP. The flag flip
  enables the SPA's "Followed kitchens" view and lifts the RLS deny
  branch that currently rejects `follows.insert`.

Going **v1 → v2**:

- Each v2 item requires a fresh design+plan session. They are not flag
  flips. The MVP/v1 codebase deliberately does not include placeholders
  for v2 (no commented-out routes, no `if (false)` blocks).
- Sharing-role expansion is the highest-risk v2 item because every RLS
  policy is touched. Plan it as a worktree-driven multi-session effort
  per
  [parallelization-guide.md](./parallelization-guide.md), not a single
  PR.

## Files this doc governs

- `/home/user/dishton/src/feature-flags/index.ts` — typed `useFeatureFlag`
  hook, `FLAGS` enum, build-time vs runtime split.
- `/home/user/dishton/src/feature-flags/registry.ts` — single source of
  truth list mirroring this doc; CI compares to the table above.
- `/home/user/dishton/.env.example` rows for every `VITE_FEATURE_*` flag.
- `/home/user/dishton/supabase/seed.sql` — initial rows for
  `app.feature_flags`.
- `/home/user/dishton/docs/15-roadmap-and-flags.md`

## Acceptance criteria

- [ ] Every flag in the table above exists either in `.env.example` (for
      build-time) or as a row in `app.feature_flags` seed (for runtime).
- [ ] `src/feature-flags/registry.ts` lists exactly the flags in the
      table; CI fails on a mismatch.
- [ ] MVP scope list maps 1:1 to the locked decisions in
      [00-overview.md](./00-overview.md) — nothing in MVP contradicts
      doc 00, nothing in doc 00 is missing from MVP.
- [ ] Each flag has a removal criterion documented in this file.
- [ ] No v2 placeholder code exists in MVP/v1 branches (CI greps for
      `// TODO: v2` comments and warns; comments must instead live in
      this doc).
- [ ] Phase ordering MVP → v1 → v2 is referenced consistently; no doc
      claims a feature is in MVP that this doc places in v1 or v2.
- [ ] No emoji anywhere in the file.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/15-roadmap-and-flags.md
grep -q "## Purpose"                docs/15-roadmap-and-flags.md
grep -q "## Prerequisites"          docs/15-roadmap-and-flags.md
grep -q "## Files this doc governs" docs/15-roadmap-and-flags.md
grep -q "## Acceptance criteria"    docs/15-roadmap-and-flags.md
grep -q "## Verification"           docs/15-roadmap-and-flags.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/15-roadmap-and-flags.md
# every flag is named
for f in VITE_FEATURE_GOOGLE_AUTH VITE_FEATURE_INSTAGRAM_IMPORT \
         VITE_FEATURE_PHOTO_IMPORT VITE_FEATURE_TRANSLATION_CACHE \
         follows_enabled public_household_pages; do
  grep -q "$f" docs/15-roadmap-and-flags.md || echo "missing flag: $f"
done
# phases named
for p in MVP v1 v2; do
  grep -q "$p" docs/15-roadmap-and-flags.md || echo "missing phase: $p"
done
# runtime flags table referenced
grep -q "feature_flags" docs/15-roadmap-and-flags.md
```

All `grep` commands must succeed and the emoji check must produce no output.
