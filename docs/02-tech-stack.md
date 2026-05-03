# 02 — Tech Stack

## Purpose

Pin every dependency Dishton uses, by name and major version, with a one-line
rationale per choice and a one-line rejection note for the obvious alternative.
This doc is the canonical reference for installs and upgrades; if a package is not
listed here, do not add it without updating this doc.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decisions.
- [01-architecture.md](./01-architecture.md) — process boundaries (some packages
  are SPA-only, some Edge-only).

## Versioning policy

- Pin **major** versions in `package.json`. `pnpm` lockfile pins the rest.
- Node `22.x` LTS. `pnpm@9`. Volta or Corepack handles version selection locally.
- Renovate runs weekly; major bumps require an updated row in this table before
  merge.

## Frontend (SPA)

| Package | Version | Rationale | Rejected alternative |
|---|---|---|---|
| `react` | `^19` | App platform; React Compiler usable. | Vue/Svelte: only-React constraint. |
| `react-dom` | `^19` | DOM renderer. | n/a |
| `typescript` | `^5.6` | Strict typing. | Flow / no-types: not on the table. |
| `vite` | `^6` | Dev server + build. | Next.js: SSR overkill for Supabase SPA. |
| `@vitejs/plugin-react` | `^4` | JSX/Fast Refresh. | n/a |
| `@tanstack/react-router` | `^1` | Typed file-based routing. | React Router v6: weaker types. |
| `@tanstack/router-vite-plugin` | `^1` | Generates the route tree. | n/a |
| `@tanstack/react-query` | `^5` | Async cache, mutations, invalidation. | SWR: smaller feature set. |
| `zustand` | `^5` | Tiny UI state slices. | Redux: ceremony. |
| `react-hook-form` | `^7` | Forms with low re-renders. | Formik: legacy. |
| `zod` | `^3` | Validation; shared client + server. | yup: weaker TS. |
| `@hookform/resolvers` | `^3` | Bridge RHF↔Zod. | n/a |
| `@supabase/supabase-js` | `^2` | Auth + DB + Storage client. | Custom REST: re-inventing. |
| `tailwindcss` | `^4` | Styling, `@theme` token model. | CSS-in-JS: slower, less idiomatic with shadcn. |
| `@tailwindcss/vite` | `^4` | Tailwind v4 Vite plugin. | PostCSS pipeline: not needed in v4. |
| `class-variance-authority` | `^0.7` | Variant-driven component API. | bespoke string concat: brittle. |
| `clsx` | `^2` | Class merging. | classnames: equivalent, smaller install footprint with clsx. |
| `tailwind-merge` | `^2` | Conflict resolution between Tailwind classes. | n/a |
| `motion` | `^12` | Animations (formerly Framer Motion). | CSS-only: insufficient for staggered list reveals. |
| `lucide-react` | `^0.460` | Icon set; tree-shakable. | Heroicons: less coverage. |
| `i18next` + `react-i18next` | `^24` / `^15` | App-shell strings. | Lingui: heavier toolchain. |
| `i18next-http-backend` | `^3` | Lazy-load locale bundles. | inline: bundle bloat. |
| `convert-units` | `^3` | Generic unit conversion base. | hand-rolled only: more bugs. |
| `nanoid` | `^5` | IDs in client (e.g. invite codes). | uuid: heavier; we keep `gen_random_uuid()` server-side. |
| `date-fns` | `^4` | Date formatting + locales. | dayjs: weaker TS. |
| `@sentry/react` | `^8` | Error tracking. | Bugsnag: cost. |

## Backend (Edge Functions, Deno)

Versions are imported via npm specifiers (`npm:@anthropic-ai/sdk@^0.40.0`)
or `https://deno.land` URLs. The values below freeze the major.

| Import | Version | Rationale |
|---|---|---|
| `npm:@anthropic-ai/sdk` | `^0.40.0` | Official Anthropic client; used for `claude-haiku-4-5` (text + vision). |
| `npm:zod@3` | `^3` | Same schemas as the SPA, imported via shared module. |
| `https://deno.land/std@0.224.0/...` | `0.224.x` | stdlib for `crypto`, `path`, `bytes`, `testing`. |
| `npm:@mozilla/readability@0.5` + `npm:linkedom@0.18` | `^0.5` / `^0.18` | Readability extraction inside Deno without a real DOM. |
| `npm:hono@4` | `^4` | Tiny request router for Edge Functions if multiple paths share one function (optional). |

Edge Functions never import React, Tailwind, or any DOM-only library.

## Dev tooling

| Package | Version | Rationale | Rejected alternative |
|---|---|---|---|
| `pnpm` | `9.x` | Fast, deterministic installs. | npm/yarn: slower / config-heavy. |
| `biome` | `^1.9` | Lint + format in one binary, fast. | ESLint + Prettier: two configs, slow. |
| `typescript` | `^5.6` | (see frontend table) | n/a |
| `husky` | `^9` | Git hooks. | lefthook: smaller community. |
| `lint-staged` | `^15` | Run Biome on staged files. | n/a |
| `tsx` | `^4` | Run TS scripts (seeders, codegen). | ts-node: slow. |
| `supabase` (CLI) | `>= 1.200` | Local DB + migrations + functions deploy. | n/a |
| `vercel` (CLI) | latest | Optional local previews. | n/a |

## Testing

| Package | Version | Layer |
|---|---|---|
| `vitest` | `^2` | Unit + component |
| `@vitest/coverage-v8` | `^2` | Coverage |
| `@testing-library/react` | `^16` | Component |
| `@testing-library/user-event` | `^14` | Component |
| `@testing-library/jest-dom` | `^6` | DOM matchers |
| `jsdom` | `^25` | Vitest DOM env |
| `fast-check` | `^3` | Property-based domain tests |
| `@playwright/test` | `^1.48` | E2E |
| Deno test runner | bundled with Deno `1.46+` | Edge Functions |

Detail in [12-testing-strategy.md](./12-testing-strategy.md).

## `package.json` skeleton

Copy verbatim into `/home/user/dishton/package.json` when the next session
bootstraps the project:

```json
{
  "name": "dishton",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 4173",
    "typecheck": "tsc -b --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "pnpm test:unit && pnpm test:components && pnpm test:edge && pnpm test:db && pnpm test:e2e",
    "test:unit": "vitest run --project domain",
    "test:components": "vitest run --project components",
    "test:coverage": "vitest run --coverage",
    "test:edge": "deno test -A supabase/functions",
    "test:db": "deno run -A supabase/tests/run.ts",
    "test:e2e": "playwright test",
    "db:reset": "supabase db reset --no-seed && supabase db push && psql $LOCAL_DB_URL -f supabase/seed.sql",
    "fn:serve": "supabase functions serve --no-verify-jwt",
    "fn:deploy": "supabase functions deploy"
  },
  "dependencies": {
    "@hookform/resolvers": "^3",
    "@sentry/react": "^8",
    "@supabase/supabase-js": "^2",
    "@tanstack/react-query": "^5",
    "@tanstack/react-router": "^1",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "convert-units": "^3",
    "date-fns": "^4",
    "i18next": "^24",
    "i18next-http-backend": "^3",
    "lucide-react": "^0.460",
    "motion": "^12",
    "nanoid": "^5",
    "react": "^19",
    "react-dom": "^19",
    "react-hook-form": "^7",
    "react-i18next": "^15",
    "tailwind-merge": "^2",
    "zod": "^3",
    "zustand": "^5"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9",
    "@playwright/test": "^1.48",
    "@tailwindcss/vite": "^4",
    "@tanstack/router-vite-plugin": "^1",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@testing-library/user-event": "^14",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4",
    "@vitest/coverage-v8": "^2",
    "fast-check": "^3",
    "husky": "^9",
    "jsdom": "^25",
    "lint-staged": "^15",
    "supabase": "^1.200.0",
    "tailwindcss": "^4",
    "tsx": "^4",
    "typescript": "^5.6",
    "vite": "^6",
    "vitest": "^2"
  }
}
```

## Repository layout

```
/home/user/dishton/
  README.md
  package.json
  pnpm-lock.yaml
  vite.config.ts
  tsconfig.json
  biome.json
  vitest.config.ts
  vitest.setup.ts
  playwright.config.ts
  .env.example
  .nvmrc                    (22)
  src/
    main.tsx
    routes/                 (TanStack Router file-based)
    domain/                 (pure TS — Zod schema, units, scale)
    lib/                    (supabase client, query client, i18n bootstrap)
    ui/
      primitives/           (Button, Card, Input, …)
      recipe/               (RecipeCard, RecipeDetail, …)
    styles/
      tokens.css
      paper-grain.svg
  supabase/
    config.toml
    migrations/             (timestamped SQL)
    seed.sql
    functions/
      _shared/
      import-url/
      import-instagram/
      import-photo/
      translate-recipe/
    tests/
  e2e/
  docs/
```

## Files this doc governs

- `/home/user/dishton/package.json`
- `/home/user/dishton/pnpm-lock.yaml` (generated, but origin defined here)
- `/home/user/dishton/biome.json`
- `/home/user/dishton/.nvmrc`
- `/home/user/dishton/tsconfig.json` (strict mode, `moduleResolution: bundler`,
  `verbatimModuleSyntax: true`)
- `/home/user/dishton/vite.config.ts`

## Acceptance criteria

- [ ] `pnpm install` succeeds from a clean checkout against the `package.json`
      skeleton above.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm build` all exit 0 on a freshly
      generated project that follows the locked structure.
- [ ] No package outside this doc appears in `dependencies` or `devDependencies`
      in `package.json`. CI grep enforces this against the generated lockfile.
- [ ] Edge Functions import only the modules listed in the "Backend" table.
- [ ] Major versions match the table; minor/patch are pinned by the lockfile.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/02-tech-stack.md
grep -q "## Purpose"                docs/02-tech-stack.md
grep -q "## Prerequisites"          docs/02-tech-stack.md
grep -q "## Files this doc governs" docs/02-tech-stack.md
grep -q "## Acceptance criteria"    docs/02-tech-stack.md
grep -q "## Verification"           docs/02-tech-stack.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/02-tech-stack.md
# every load-bearing dependency must be named
for p in react vite typescript "@tanstack/react-router" "@tanstack/react-query" \
         "@supabase/supabase-js" tailwindcss zod biome vitest "@playwright/test" \
         motion zustand react-hook-form pnpm; do
  grep -q "$p" docs/02-tech-stack.md || echo "missing dep: $p"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
