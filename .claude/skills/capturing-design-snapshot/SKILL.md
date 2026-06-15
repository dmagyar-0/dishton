---
name: capturing-design-snapshot
description: Use when you need a full visual snapshot of the Dishton UI to sync the Claude design web app — capturing screenshots of every route and interactive state at desktop and mobile, recording the synced commit hash, and summarising UI/UX changes since the last sync.
---

# Capturing a Design Snapshot

## Overview

Produces a complete, current picture of Dishton's UI for the Claude design web
app to keep the project HTML in sync. One run pulls the latest `main`, drives
Playwright through **every route and interactive state** at desktop **and**
mobile, records the exact `main` commit it snapshotted, summarises what changed
since the last sync (UI/UX-affecting paths only), and commits everything to a
dedicated `design-sync` branch.

This reuses the environment setup of the `validating-features-visually` skill
(docker daemon, Supabase CLI tarball, Playwright) — that skill is the authority
for *why* the stack boots the way it does in the sandbox.

## When to use

- You want to refresh the Claude design web app with the app's current look.
- You need to know what UI/UX changed on `main` since the last design sync.
- You want a committed, hash-stamped set of screenshots covering the whole UI.

Not for verifying a single feature you just built — use
`validating-features-visually` for that (it judges against intent; this one
captures breadth).

## How to run

```bash
bash .claude/skills/capturing-design-snapshot/run.sh
git push -u origin design-sync     # publish so the design app + next run can read it
```

`run.sh` is idempotent and self-contained. It will:

1. Read the previously-synced `main` hash from `origin/design-sync`'s manifest.
2. `git checkout main && git pull` — **the snapshot always reflects latest main.**
3. Ensure docker / Supabase CLI / Playwright, then `supabase start -x edge-runtime,functions` and `supabase db reset` (loads `supabase/seed.sql`).
4. Bump the seeded `alice` password via the Auth admin API (login needs ≥10 chars).
5. `pnpm build` + `pnpm preview`, then run `capture.spec.ts` under both Playwright projects (desktop Chrome + Pixel 5).
6. Write `design-sync/CHANGELOG.md` (commits + diffstat over UI paths, `prev..main`) and `design-sync/manifest.json`.
7. Tear down the stack, then commit `design-sync/` to the `design-sync` branch.

Pushing is the one manual step (so you stay in control of what leaves the box).

## What gets captured

`capture.spec.ts` walks three contexts, each at desktop + mobile:

| Context | Surfaces |
|---|---|
| Unauthenticated | login, signup, reset, update-password, onboarding, public share (active + imperial + dead-link inactive) |
| Solo user (fresh signup) | empty home, profile, all import tabs (+ filled manual form), all solo settings tabs, invite-code dialog, empty following |
| Household user (seeded `alice`/The Pantry) | populated list, search (results + empty), expanded tag filters, delete-confirm dialog, recipe detail (default/imperial/scaled/language), share dialog, recipe edit (populated + validation), non-solo settings (Members + Danger Zone + name editor), populated following |

The household block **never saves a mutation** (it only opens dialogs and
fills-without-saving) so the seed stays deterministic across reruns.

## Outputs (committed to the `design-sync` branch)

```
design-sync/
  manifest.json          # generated_at, main_hash, previous_main_hash, screenshot index
  CHANGELOG.md           # UI/UX-affecting commits + diffstat since last sync
  screenshots/
    desktop/NN-*.png
    mobile/NN-*.png
```

`manifest.json` is the entry point for the design web app: `main_hash` is the
synced commit, `previous_main_hash` is what it's diffed against, and
`screenshots.{desktop,mobile}` list the files in capture order.

## Extending the capture

The spec uses resilient optional interactions (`tap()` no-ops if a control is
absent), so it won't crash when the UI shifts — but **new routes/states won't
appear unless you add them.** When `CHANGELOG.md` shows a new route or surface,
add a `goto` + `shot(...)` for it in `capture.spec.ts` before relying on the
next snapshot for design sync. Seeded IDs live at the top of the spec.

## Common mistakes

- **Snapshotting a feature branch.** The script forces `main`; don't run it mid-feature expecting your unpushed work to show.
- **Forgetting to push `design-sync`.** The next run reads the previous hash from `origin/design-sync` — without a push, every run reports "first sync" and the changelog is empty.
- **Expecting AI-import results.** Edge functions can't run in the sandbox; the import *tabs/forms* are captured, but URL/photo/chat extraction and live translation are not. That's a stack limit, not a UI bug.
- **Running parts by hand and skipping `db reset`.** Without the seed there's no `alice`, no recipes, and the household context can't be captured.
