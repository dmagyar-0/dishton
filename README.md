# Dishton

An AI-powered recipe-collection web app. Households share a recipe collection,
follow other households read-only, and import recipes from URLs, Instagram
posts, photos, or manual entry into one canonical structured form. Every
recipe renders with per-user unit and language preferences and is scalable by
serving count or multiplier.

## Architecture (high-level)

```
React SPA (Vite) ──HTTPS──► Supabase (Postgres + Auth + Storage + Edge Functions) ──► NVIDIA NIM
```

The browser never holds the NVIDIA key. All AI calls go through Supabase Edge
Functions. See [docs/01-architecture.md](docs/01-architecture.md) for the full
diagram.

## Documentation

The docs under [`docs/`](docs/) are the single source of truth for every
implementation decision. Start with [`docs/00-overview.md`](docs/00-overview.md)
and the [doc map](docs/00-overview.md#doc-map). Locked decisions live there;
nothing in this repo overrides them.

## Local development

Prerequisites: Node 22.x, pnpm 10+, Docker (for `supabase start`), Deno
(for Edge Function tests), `supabase` CLI.

```bash
pnpm install
cp .env.example .env.local         # fill in VITE_SUPABASE_* from supabase status
pnpm dev                            # SPA at http://localhost:5173
supabase start                      # local Postgres + Auth + Storage + Edge Functions
pnpm test                           # full pyramid (unit + components)
```

## Streams (parallelization)

See [`docs/parallelization-guide.md`](docs/parallelization-guide.md) for the
work-stream graph and the three frozen contracts (Recipe Zod schema, SQL
schema, design tokens).
