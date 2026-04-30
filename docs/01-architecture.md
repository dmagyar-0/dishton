# 01 — Architecture

## Purpose

Describe Dishton's runtime topology, the responsibilities of each process, the data
flows behind every load-bearing user story, and the environment variables and
deployment surfaces those processes consume. After reading this doc an engineer
should know which process owns the code they are about to write and how a request
travels through the system.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decisions and glossary.

## System diagram

```
                                  Internet
                                     │
                                     ▼
                           ┌────────────────────┐
                           │  React SPA         │
                           │  (Vite build,      │
                           │   served by Vercel │
                           │   static hosting)  │
                           └────────┬───────────┘
                                    │ HTTPS
                                    │ supabase-js (JWT in Authorization header)
                                    ▼
              ┌─────────────────────────────────────────┐
              │              Supabase                   │
              │                                         │
              │  ┌────────┐  ┌─────────┐  ┌──────────┐  │
              │  │ Auth   │  │Postgres │  │ Storage  │  │
              │  │(GoTrue)│  │  + RLS  │  │ (S3 API) │  │
              │  └────────┘  └────┬────┘  └────┬─────┘  │
              │                   │            │        │
              │  ┌────────────────┴────────────┴─────┐  │
              │  │ Edge Functions (Deno)             │  │
              │  │  • import-url                     │  │
              │  │  • import-instagram               │  │
              │  │  • import-photo                   │  │
              │  │  • translate-recipe               │  │
              │  │  (all hold NVIDIA_API_KEY)        │  │
              │  └─────────────┬─────────────────────┘  │
              │                │ HTTPS (server-side)    │
              └────────────────┼────────────────────────┘
                               ▼
                  ┌─────────────────────────────┐
                  │ NVIDIA NIM                  │
                  │ integrate.api.nvidia.com/v1 │
                  │  • llama-3.3-70b-instruct   │
                  │  • llama-3.2-90b-vision     │
                  └─────────────────────────────┘

      Optional outbound (server-side, from Edge Functions only):
        - oEmbed (Instagram)         → graph.facebook.com/v18.0/instagram_oembed
        - URL fetch for blog imports → arbitrary HTTPS, with allow-listed UA
```

The browser **never** holds the NVIDIA key, never calls NVIDIA directly, and never
calls third-party blogs. Every outbound request that needs a secret is an Edge
Function call.

## Process responsibilities

| Process | Owns | Does not own |
|---|---|---|
| **React SPA** | UI, routing, optimistic state, view-time unit conversion (pure functions from `src/domain/units`), per-language fetches against Postgres, displaying drafts returned by Edge Functions | AI calls, secrets, server-side fetch, business validation that requires multi-row checks |
| **Postgres + RLS** | Authoritative recipe data, household membership, follow graph, FTS, `import_jobs` state, translation cache, AI rate budget row | Anything that requires a secret outside the DB; `auth.users` table belongs to GoTrue, never written directly |
| **Storage** | `recipe-images` (public, served via signed URLs from the SPA), `imports` (private originals; only Edge Functions read) | Long-term archival or backup; rotation handled by Supabase platform |
| **Edge Functions** | All NVIDIA calls, all third-party fetches (oEmbed, blog HTML), Zod validation of model output, retry/backoff, writing `import_jobs` rows, decrementing `ai_rate_budget` | UI logic, browser-bound state, view-time computations |
| **NVIDIA NIM** | Text structuring, vision OCR-and-structuring, translation | Storage, persistence, access control |

## Data flows

The five flows below cover every load-bearing user story. Each step is annotated
with the process performing the work.

### 1. Signup + first-run household creation

```
[Browser]  POST /auth/v1/signup (email, password)        ─► [Auth/GoTrue]
[Auth]     200 OK + JWT                                   ─► [Browser]
[Browser]  upsert into app.profiles (auth.uid)            ─► [Postgres]
[Browser]  route guard: profile has no household?         ─► [Browser]
[Browser]  /onboarding (create household | redeem invite)
   create:  insert households + household_members(role=owner)
   redeem:  RPC app.redeem_invite(code) → insert household_members(role=editor)
[Browser]  route guard: profile now has household → /
```

### 2. URL import

```
[Browser]  user pastes URL into Import panel
[Browser]  POST /functions/v1/import-url { url }         ─► [Edge: import-url]
[Edge]     insert import_jobs(status=running, kind=url)
[Edge]     fetch URL with allow-listed UA, follow ≤ 3 redirects, 5 MB cap
[Edge]     readability extract → cleaned HTML/text
[Edge]     check ai_rate_budget; reserve estimated tokens
[Edge]     call NIM (text model) with structuring prompt + Zod schema
[Edge]     parse JSON; on parse error, re-prompt once with the error message
[Edge]     Zod-validate; on hard failure, mark import_jobs.status=needs_review
[Edge]     return draft Recipe (not yet saved) + import_jobs.id
[Browser]  open Edit Draft modal pre-filled with draft
[Browser]  user edits; on Save, INSERT into recipes/recipe_*  ─► [Postgres]
[Browser]  update import_jobs.status=done                     ─► [Postgres]
```

### 3. Photo import

```
[Browser]  user picks an image (≤ 10 MB)
[Browser]  upload to Storage bucket `imports/<uid>/<jobId>.jpg`
[Browser]  POST /functions/v1/import-photo { jobId, path } ─► [Edge: import-photo]
[Edge]     create signed read URL for the object (5 min TTL)
[Edge]     check ai_rate_budget
[Edge]     call NIM vision model with the signed URL + structuring prompt
[Edge]     parse + Zod-validate (low-confidence path: status=needs_review)
[Edge]     return draft
[Browser]  Edit Draft modal → Save → recipes row created
```

### 4. View recipe with unit + language toggle

```
[Browser]  GET /h/:householdId/r/:recipeId
[Browser]  TanStack Query: select * from recipes where id=:id
[Browser]  TanStack Query: select * from recipe_ingredients where recipe_id=:id
[Browser]  TanStack Query: select * from recipe_steps where recipe_id=:id
[Browser]  read profile.preferred_unit_system, preferred_language
[Browser]  if URL has ?units= or ?lang=, use override (sticky)
[Browser]  view-time conversion via src/domain/units (pure function, no I/O)
[Browser]  if displayLang ≠ recipe.source_language:
    look up recipe_translations(recipe_id, language)
    cache hit  → render translated payload
    cache miss → POST /functions/v1/translate-recipe
                 Edge translates, INSERTs into recipe_translations,
                 returns translated payload
[Browser]  scale slider changes URL ?scale=N → re-render via src/domain/scale
```

### 5. Follow another household

```
[Browser]  user enters share code on /following
[Browser]  RPC app.add_follow(target_household_id_from_code)
[Postgres] INSERT into follows (RLS allows owner of own household to insert)
[Postgres] Realtime channel households:<targetId>:recipes opened by SPA
[Browser]  /following lists recipes from followed households (RLS read-only)
```

## Environment variables

Variables prefixed `VITE_` are inlined into the SPA bundle and are public.
Everything else is server-side only.

| Variable | Where | Required by | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Vercel + local `.env` | SPA | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Vercel + local `.env` | SPA | Anon key, RLS-gated |
| `VITE_FEATURE_GOOGLE_AUTH` | Vercel + local `.env` | SPA | `false` until v1 |
| `VITE_FEATURE_INSTAGRAM_IMPORT` | Vercel + local `.env` | SPA | feature gate |
| `VITE_FEATURE_PHOTO_IMPORT` | Vercel + local `.env` | SPA | feature gate |
| `VITE_FEATURE_TRANSLATION_CACHE` | Vercel + local `.env` | SPA | feature gate |
| `VITE_SENTRY_DSN` | Vercel | SPA | optional, prod only |
| `NVIDIA_API_KEY` | Supabase Functions secrets | Edge Functions | NIM access |
| `NIM_TEXT_MODEL` | Supabase Functions secrets | Edge Functions | default `meta/llama-3.3-70b-instruct` |
| `NIM_VISION_MODEL` | Supabase Functions secrets | Edge Functions | default `meta/llama-3.2-90b-vision-instruct` |
| `IG_OEMBED_TOKEN` | Supabase Functions secrets | Edge: import-instagram | App-scoped Facebook Graph token |
| `LOG_DRAIN_TOKEN` | Supabase Functions secrets | Edge Functions | structured-log forwarding |
| `NIM_MOCK_MODE` | local + CI only | Edge Functions | `playwright` to read fixtures instead of calling NIM |

The full secrets matrix (which environment holds which secret) is in
[13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).

## Deployment topology

| Surface | Hosted by | What ships |
|---|---|---|
| SPA | Vercel (static + edge CDN) | `dist/` from `vite build` |
| Postgres + Auth + Storage | Supabase managed | Migrations applied via `supabase db push` |
| Edge Functions | Supabase managed | `supabase/functions/*` deployed via `supabase functions deploy` |
| NVIDIA NIM | NVIDIA | external; we hit `https://integrate.api.nvidia.com/v1` |

Three environments (`local`, `preview`, `production`) — see
[13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md). Local uses
`supabase start` (Docker) plus `pnpm dev`.

## Third-party services

| Service | Purpose | Outage behaviour |
|---|---|---|
| NVIDIA NIM | All AI structuring + translation | Imports show "AI temporarily unavailable, edit manually"; manual entry remains available; existing recipes unaffected |
| Facebook Graph oEmbed | Instagram caption + thumbnail | Instagram tab disabled with banner; URL/photo/manual still work |
| Vercel | SPA hosting | Site down; existing PWA caches still serve recipe views and edits queue offline (see [11-pwa-and-offline.md](./11-pwa-and-offline.md)) |
| Supabase | Everything else | Hard outage; we surface a single global error toast |
| Sentry | Error tracking | Best-effort; failures swallowed |

## Files this doc governs

- `/home/user/dishton/.env.example`
- `/home/user/dishton/supabase/config.toml` (locally-managed Supabase config)
- `/home/user/dishton/vercel.json` (if needed for headers/rewrites)
- `/home/user/dishton/src/lib/supabase.ts` (the single SPA Supabase client)
- `/home/user/dishton/supabase/functions/_shared/env.ts` (Edge Function env loader)
- `/home/user/dishton/README.md` (high-level architecture paragraph + diagram link)

## Acceptance criteria

- [ ] `.env.example` lists every `VITE_*` variable named in this doc and no others.
- [ ] `supabase/functions/_shared/env.ts` resolves every server-side variable named
      here and throws on missing values during cold start.
- [ ] `src/lib/supabase.ts` is the only module in `src/**` that constructs a
      Supabase client; all other modules import from it.
- [ ] No file under `src/**` imports `openai` or references `nvidia.com`.
- [ ] The data-flow descriptions in this doc match the implementations in
      [05-auth-and-households.md](./05-auth-and-households.md),
      [08-import-pipelines.md](./08-import-pipelines.md), and
      [09-recipe-views.md](./09-recipe-views.md).

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/01-architecture.md
grep -q "## Purpose"                docs/01-architecture.md
grep -q "## Prerequisites"          docs/01-architecture.md
grep -q "## Files this doc governs" docs/01-architecture.md
grep -q "## Acceptance criteria"    docs/01-architecture.md
grep -q "## Verification"           docs/01-architecture.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/01-architecture.md
# every promised env var is referenced
for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY NVIDIA_API_KEY NIM_TEXT_MODEL \
         NIM_VISION_MODEL IG_OEMBED_TOKEN; do
  grep -q "$v" docs/01-architecture.md || echo "missing env var: $v"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
