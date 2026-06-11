# 00 — Overview

## Purpose

Dishton is an AI-powered recipe-collection web app. Users sign up, join or create a
**household** with a shared recipe collection, optionally **follow** other households
read-only, and import recipes from any source (URL, Instagram URL, photo, or manual)
into one canonical structured form. Every recipe renders with per-user unit and
language preferences and is scalable by serving count or multiplier. This document
is the north star: it locks the product scope, technology decisions, data-model
shape, and design direction so every later implementation session converges. Read
this first; everything else expands one slice of what is summarised here.

## Prerequisites

None. This is the entry point.

## Locked decisions

These are non-negotiable for all later docs and implementation sessions. Anything
not listed here is open to refinement inside the relevant doc, provided it does not
contradict a locked choice.

| Area | Choice |
|---|---|
| Platform | Web only, mobile-first responsive PWA |
| Frontend framework | React 19 + TypeScript (strict) on Vite 6 |
| Routing / data | TanStack Router + TanStack Query |
| Local UI state | Zustand (drawers, scaling slider, etc.) |
| Styling | Tailwind CSS v4 + shadcn/ui (heavily restyled per Editorial Pantry) |
| Forms / validation | `react-hook-form` + `zod` (schemas shared client + server) |
| App-shell i18n | `i18next` + `react-i18next` |
| Recipe-content i18n | AI translation, cached per recipe per language in DB |
| Unit conversion | `convert-units` plus a custom cooking-unit graph |
| Lint / format | Biome (single tool, replaces ESLint + Prettier) |
| Unit testing | Vitest + Testing Library |
| E2E testing | Playwright (smoke flows only) |
| Backend | Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) |
| Auth methods | Email/password day one; Google OAuth wired but feature-flagged |
| Sharing model | **Households** (shared, read/write) + **Follows** (read-only) |
| AI provider | Anthropic API at `https://api.anthropic.com/v1/messages` |
| AI model (text + vision) | `claude-haiku-4-5` — single multimodal model for both lanes |
| AI key location | Server-side only, in Supabase Edge Functions |
| Instagram ingestion | Public oEmbed endpoint (caption + thumbnail). No IG Graph API |
| Storage strategy | Canonical recipe JSON in Postgres; per-language translations cached in `recipe_translations`; per-user unit conversion at view time |
| Aesthetic | "Editorial Pantry" — Fraunces display, General Sans body, JetBrains Mono numerals, paper/saffron/sage palette. Inter/Roboto/system stacks are forbidden |
| Package manager | `pnpm` |
| Node version | `22.x` LTS |

## Glossary

| Term | Meaning |
|---|---|
| **Household** | The primary tenancy boundary. A group of profiles that share read/write access to one recipe collection. |
| **Follow** | A one-way, read-only link from one household to another so users can browse the followed household's collection ("wider family"). |
| **Profile** | The user-facing identity row keyed by `auth.uid`; holds display name, locale, and unit/language preferences. |
| **Canonical recipe** | The structured JSON form (ingredients, steps, timings, servings) that every import is normalised into and stored as. |
| **Source language** | The language the recipe was authored in. Stored on the recipe row; used as the translation source. |
| **Display language** | The language the current user wants to read recipes in. Resolved per request from profile preference, with per-recipe URL override. |
| **Display unit system** | The user's preferred unit family (metric / imperial). Conversion happens at view time. |
| **Canonical unit system** | The unit family the recipe was originally stored in. Preserved verbatim. |
| **Import job** | A row in `import_jobs` tracking one URL/Instagram/photo ingestion through queued → running → done/failed. |
| **Edge Function** | A Deno function deployed on Supabase that holds the Anthropic key, calls AI models, and returns structured drafts. |
| **Editorial Pantry** | The locked visual/typographic system; see `03-design-system.md`. |
| **Token-bucket** | A single-row Postgres table (`ai_rate_budget`) used as a global throttle for Anthropic calls. |

## Doc map

```
docs/
  00-overview.md              ← you are here
  01-architecture.md          system diagram, data flow, env, deploy
  02-tech-stack.md            packages + versions + rationale
  03-design-system.md         Editorial Pantry tokens + components
  04-data-model.md            SQL DDL + RLS + indexes + seed
  05-auth-and-households.md   auth, invites, follow flows, screens
  06-recipe-domain.md         canonical Zod schema + unit graph + scaling
  07-ai-integration.md        Anthropic client, prompts, validation, retry
  08-import-pipelines.md      URL / Instagram / photo / manual end-to-end
  09-recipe-views.md          list / detail / edit / scale / unit / lang
  10-search-and-tags.md       Postgres FTS + tag chips
  11-pwa-and-offline.md       manifest, service worker, screen-wake
  12-testing-strategy.md      Vitest + Playwright + Supabase test harness
  13-ci-cd-and-environments.md  Actions, migrations, preview envs
  14-observability.md         logs, Sentry, AI cost dashboard
  15-roadmap-and-flags.md     deferred work + feature flags
  parallelization-guide.md    dependency graph for parallel sessions
```

Dependency tiers (a doc never assumes a doc from a later tier):

- **Tier 0** — `00`, `01`, `02`. Foundational; written together.
- **Tier 1** — `03`, `04`, `06`. Independent, parallelisable.
- **Tier 2** — `05` (needs `03`+`04`), `07` (needs `06`).
- **Tier 3** — `08` (needs `06`+`07`, touches `04`).
- **Tier 4** — `09`, `10` (need `05`+`08`).
- **Tier 5** — `11`, `12`, `13`, `14`, `15`. Cross-cutting; written together.

## How to read these docs

1. Always start with `00-overview.md` to confirm a decision is locked vs open.
2. Read `01-architecture.md` next to know which process owns the code you are about
   to write (browser SPA, Edge Function, Postgres, third-party).
3. Read `02-tech-stack.md` before installing or upgrading any dependency.
4. Then jump to the doc whose `## Files this doc governs` section names the file
   you need to create or change. Each doc is self-contained — it lists its own
   prerequisites, governed paths, acceptance criteria, and verification commands.
5. If two docs appear to disagree, the lower-numbered doc wins. If the disagreement
   is with `00-overview.md`, stop and raise it; do not silently diverge.
6. Cross-references use relative paths (e.g.
   [tech stack](./02-tech-stack.md)). Follow them rather than re-deriving.

## Out of scope (for the project, not just this doc)

- Native mobile apps (PWA install only).
- Meal planning, shopping-list export, nutrition computation.
- Multi-household role hierarchies beyond `owner` / `editor`.
- Public/anonymous browsing of collections outside the follow model. (Opt-in,
  revocable single-recipe share links shipped 2026-06 as the sharing loop's
  landing surface; see
  `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`.)
- Self-hosting Supabase or running our own LLMs.

These may appear in `15-roadmap-and-flags.md` as future work but are not built now.

## Files this doc governs

- `/home/user/dishton/docs/00-overview.md`
- `/home/user/dishton/README.md` — short pointer paragraph linking to this doc and
  to the doc map.

## Acceptance criteria

- [ ] `/home/user/dishton/docs/00-overview.md` exists and contains every section
  required by the house style (Purpose, Prerequisites, body, Files, Acceptance,
  Verification).
- [ ] Every locked decision in the master plan
  (`/root/.claude/plans/we-are-starting-a-giggly-goblet.md`) appears in the
  "Locked decisions" table or the "Glossary".
- [ ] Doc map lists exactly the 16 documents named in the master plan plus
  `parallelization-guide.md`.
- [ ] Glossary defines: Household, Follow, Profile, Canonical recipe, Source
  language, Display language, Display unit system, Canonical unit system, Import
  job, Edge Function, Editorial Pantry, Token-bucket.
- [ ] No emojis anywhere in the file.
- [ ] No section refers to a doc tier later than its own tier (this doc may
  reference any doc; later docs may not back-reference forward).

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/00-overview.md
grep -q "## Purpose"             docs/00-overview.md
grep -q "## Prerequisites"       docs/00-overview.md
grep -q "## Files this doc governs" docs/00-overview.md
grep -q "## Acceptance criteria" docs/00-overview.md
grep -q "## Verification"        docs/00-overview.md
# emoji check (matches the most common emoji ranges)
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/00-overview.md
# every doc named in the doc-map exists once we reach end of the doc-authoring effort
for f in 00-overview 01-architecture 02-tech-stack 03-design-system 04-data-model \
         05-auth-and-households 06-recipe-domain 07-ai-integration \
         08-import-pipelines 09-recipe-views 10-search-and-tags \
         11-pwa-and-offline 12-testing-strategy 13-ci-cd-and-environments \
         14-observability 15-roadmap-and-flags parallelization-guide; do
  grep -q "$f" docs/00-overview.md || echo "missing reference: $f"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
