# Dishton — AI Usage Summary for CV

A recipe-collection PWA (side project) with production AI-powered recipe import.
This document collects ready-to-use blurbs at several lengths so you can pick
what fits your CV format. All details are verified against the codebase.

**Stack:** React + Vite SPA · Supabase (Postgres, Auth, Storage) · Deno Edge Functions · Anthropic Claude

---

## 1. One-line bullets (dense CV / ATS-friendly)

Pick one, or mix and match:

- Built AI recipe import with **Anthropic Claude** (Haiku 4.5 text + Sonnet 4.6 vision) in **Deno serverless edge functions** — structured extraction from URLs, Instagram captions, and cookbook photos.
- Shipped production LLM features with **schema-validated structured outputs** (forced tool use + Zod) and a self-repair loop, **prompt caching**, and **token-bucket rate limiting** for cost control.
- Engineered a secure server-side AI layer — API keys never reach the browser, with SSRF guards, prompt-injection hardening, and structured logging/observability to Better Stack.

---

## 2. Two-line bullet (standard CV project entry)

> **Dishton** — AI-powered recipe-collection PWA (React/Vite, Supabase, Deno Edge Functions).
> Built production recipe import using **Anthropic Claude** (Haiku 4.5 text / Sonnet 4.6 vision): forced tool-use for **Zod-validated structured output** with a bounded self-repair loop, **prompt caching** + **token-bucket rate limiting** for cost control, and full observability via structured logging. All model calls run server-side — keys never touch the browser.

---

## 3. Paragraph (CV summary / cover letter)

> Built an AI-powered recipe platform using **Anthropic Claude** (Haiku 4.5 for text, Sonnet 4.6 for vision) running in **Deno serverless edge functions** — extracting structured recipes from URLs, Instagram captions, and cookbook photos, plus interactive recipe drafting via the Managed Agents API. Engineered for production: forced tool-use for **schema-validated structured output** (Zod) with a bounded self-repair loop, **prompt caching** and **token-bucket rate limiting** (per-user + global) for cost control, SSRF/prompt-injection hardening, and full observability via structured logging to Better Stack. API keys never touch the browser — all model calls run server-side.

---

## 4. Extended prose (portfolio / LinkedIn project section)

> Dishton is a recipe-collection PWA whose core feature is AI-driven import: paste a URL, Instagram link, or photo of a cookbook page and get a clean, structured recipe. The AI layer runs entirely in **Deno Edge Functions** backed by **Supabase**, calling **Anthropic Claude** across three lanes — text (Haiku 4.5) for HTML/caption parsing, vision (Sonnet 4.6) for multi-column cookbook photo extraction, and an agent lane (Managed Agents API) for conversational recipe drafting.
>
> Production engineering highlights: model output is constrained with **forced tool use** and validated against the same **Zod schema shared between the SPA and edge functions**, with a one-shot **repair loop** that re-prompts on validation errors so malformed drafts never reach the user. Cost and abuse are controlled with **ephemeral prompt caching** and **token-bucket rate limiting** at both per-profile and global scope (HTTP 429 + retry-after). The system handles untrusted input defensively — SSRF-guarded fetches, prompt-injection framing around scraped content, and http/https-only sanitization — and is fully observable, emitting structured JSON logs (latency, token usage, cache hit/miss, model) to a Better Stack drain. Imports run as detached background jobs (HTTP 202 + realtime completion), and an `AI_MOCK_MODE` lets the entire flow run offline in CI/E2E with no API key. Model selection (Haiku vs. Sonnet for vision) was **eval-driven** rather than guessed.

---

## 5. Skills / keywords (for a skills section or ATS keyword pass)

`LLM integration` · `Anthropic Claude API` · `structured outputs / tool use` ·
`Zod schema validation` · `prompt engineering` · `prompt caching` ·
`rate limiting (token bucket)` · `vision models / OCR` · `AI agents (Managed Agents API)` ·
`Deno` · `serverless edge functions` · `Supabase` · `PostgreSQL / RLS` ·
`prompt-injection & SSRF hardening` · `observability / structured logging` ·
`eval-driven model selection` · `TypeScript` · `React`

---

## 6. Factual reference (so any wording stays accurate)

**Provider / models**
- Anthropic Claude via `@anthropic-ai/sdk` (text + vision); raw HTTP for Managed Agents API.
- Text & caption lane: `claude-haiku-4-5`. Vision lane: `claude-sonnet-4-6`. Configurable via `ANTHROPIC_MODEL` / `ANTHROPIC_MODEL_VISION`.

**AI-powered features**
- Recipe import from website URLs (HTML scrape → structured recipe).
- Recipe import from Instagram captions.
- Recipe import from cookbook photos (vision, handles multi-column layouts).
- Recipe translation into the user's language (with caching).
- Interactive recipe drafting via Anthropic Managed Agents API.

**Production engineering**
- API keys live server-side only (Supabase secrets); browser never holds keys.
- Forced tool use (`tool_choice`) → JSON, validated against shared Zod `Recipe` schema; bounded re-prompt repair loop on validation failure.
- Ephemeral prompt caching on the large stable preamble for cost reduction.
- Token-bucket rate limiting at per-profile + global scope (HTTP 429 + retry-after).
- Retries with exponential backoff + jitter on 5xx/429/connection errors; 90s timeout per lane.
- Detached background imports (HTTP 202 + Supabase realtime completion).
- `AI_MOCK_MODE=1` short-circuits to fixtures for offline CI/E2E.
- Structured JSON logging (request id, model, latency, token + cache usage) → Better Stack drain.
- Defensive input handling: SSRF-guarded fetches, prompt-injection framing of scraped content, http/https-only URL sanitization.
- Eval-driven model choice (vision reliability vs. cost).

**Tech stack**
- React + Vite SPA, TanStack Router, Tailwind/Radix.
- Supabase: Postgres + RLS, Auth, Storage, Edge Functions.
- Deno runtime for edge functions; Zod schemas shared between SPA and functions.
