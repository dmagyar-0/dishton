---
name: validating-features-visually
description: Use after implementing or modifying any user-facing feature in Dishton, before claiming it complete. Drives Playwright through the new flow plus adjacent surfaces against a locally-built SPA + local Supabase, captures screenshots at desktop and mobile viewports, and surfaces visual or behavioral regressions that typechecks and unit tests don't catch. Required by CLAUDE.md.
---

# Validating Features Visually

## Why this exists

Typecheck + unit tests catch code-correctness regressions. They do NOT catch:

- Flash-of-wrong-content from conditional renders that depend on multiple async queries (e.g. `isSolo` needing both `household.data` and memberships)
- Mobile layout overflow (chips, headers, modal codes)
- i18n keys rendering raw because a translation file lost a key
- Profile/auth fields populated from the wrong source post-signup
- Empty/loading states with stale or missing copy

PRs #61, #62, #63 all shipped through green CI and needed follow-up fixes because nobody opened the page in a browser before merging. This skill makes "open the page" a deterministic, screenshot-capturing procedure.

## When to use

After any change that affects what the user sees: new route, new component, copy change, layout adjustment, conditional render based on backend state. Skip only for purely internal refactors (types, helper renames) where the rendered output cannot have changed.

## Prerequisites

Each runs once per session; cache them. **Run all three before deciding the
environment can't support this skill.** "`docker info` failed" is not a reason
to skip — start the daemon and continue. The remote Claude-Code-on-the-Web
container ships with `sudo dockerd` available and Playwright pre-staged at
`/opt/pw-browsers/`; the steps below have all worked there.

```bash
# 1. Docker daemon (in restricted sandboxes it may not auto-start).
# This is the step most commonly skipped. Don't skip it.
docker info >/dev/null 2>&1 || sudo dockerd > /tmp/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 1; done

# 2. Supabase CLI — DO NOT mv the `supabase` binary alone; the shim
# needs `supabase-go` colocated. Install the tarball into a directory:
mkdir -p "$HOME/.local/share/supabase"
curl -sL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz" \
  | tar -xzf - -C "$HOME/.local/share/supabase"
export PATH="$HOME/.local/share/supabase:$PATH"

# 3. Playwright Chromium (already cached under /opt/pw-browsers on web).
pnpm exec playwright install chromium --with-deps
```

If a step still fails after a real attempt, surface the actual error to the
user and ask — don't silently fall back to "I'll commit and let CI catch it".

## Procedure

### 1. Start the local stack

Edge-runtime and functions containers fail in restricted sandboxes (rlimit error). Skip them — they're not needed for visual validation. AI import flows won't work, but everything else will.

```bash
supabase start -x edge-runtime,functions
```

Confirm-on-signup is **off** in `supabase/config.toml`, so signups land directly in the app.

Grab credentials:

```bash
supabase status -o json
```

### 2. Point the SPA at local Supabase

```bash
cat > .env.local <<EOF
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY from supabase status>
VITE_FEATURE_GOOGLE_AUTH=false
VITE_FEATURE_INSTAGRAM_IMPORT=true
VITE_FEATURE_TRANSLATION_CACHE=true
EOF
```

### 3. Build and serve

Use `pnpm preview`, not `pnpm dev` — PWA caching only kicks in on built output (per CLAUDE.md "Gotchas").

```bash
pnpm build
pnpm preview --host 127.0.0.1 --port 4173 > /tmp/preview.log 2>&1 &
echo $! > /tmp/preview.pid
```

### 4. Write a Playwright spec

Drop the spec under `e2e/` so Playwright picks it up. The `e2e/walkthrough.spec.ts` name is fine for a throwaway; delete it during cleanup.

```ts
import { expect, test } from '@playwright/test';

test('visual: <feature>', async ({ page }) => {
  const email = `claude-test-${Date.now()}@dishton.test`;
  const password = 'test-password-1234';

  // Always start from signup. Solo-household-on-signup means a fresh
  // user lands at /h/<id> with their personal household ready.
  await page.goto('/');
  await page.getByRole('link', { name: /create account/i }).click();
  await page.getByLabel(/display name/i).fill('Visual Tester');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/h\//, { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // ---- feature-specific flow goes here ----
  await page.screenshot({ path: '/tmp/screenshots/01-feature-entry.png', fullPage: true });
  // ... navigate, interact, screenshot at each meaningful state

  // Adjacent surfaces — regressions often hide one click away.
  for (const [name, label] of [
    ['home', /my recipes/i],
    ['import', /import/i],
    ['search', /search/i],
    ['settings', /settings/i],
    ['profile', /profile/i],
  ] as const) {
    const link = page.getByRole('link', { name: label }).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `/tmp/screenshots/adj-${name}.png`, fullPage: true });
    }
  }

  // Mobile viewport — header nav and modals have repeatedly regressed
  // here (PRs #61, #62).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/screenshots/99-mobile-home.png', fullPage: true });
});
```

Run:

```bash
mkdir -p /tmp/screenshots
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 \
  pnpm exec playwright test e2e/walkthrough.spec.ts --reporter=list
```

### 5. Inspect every screenshot

`Read` each PNG. Don't claim a feature works because the spec passed — the spec only asserts navigation; it doesn't see layout overflow, wrong copy, or wrong conditional render.

Specifically check:

| Surface | What to verify |
|---|---|
| Recipe list (home) | `isSolo` rendering — solo users see "My Recipes" + "Welcome — let's fill the shelves", not "Recipes" + "Your pantry is empty". If desktop differs from mobile, you've caught a flash-of-wrong-content bug. |
| Settings | Solo vs household tabs — solo hides Members, Danger Zone, name editor; shows "This space is yours" + "When you want to share" callouts. |
| Profile | Display name field shows the name typed at signup, not the email's local-part. |
| Search | Has a real empty state (not a barren input on an empty page). |
| Mobile (390px) | Header icons fit on one row, no clipped content, invite codes wrap. |
| Any new route | Empty/loading states have copy, not blank cards. |

### 6. Report findings

To the user, in this order:
1. Send screenshots via `SendUserFile`.
2. Frame findings as observations with caveats, not assertions: "Desktop shows X, mobile shows Y on the same route — could be timing or a real bug, worth a closer look at `src/routes/.../X.tsx:NN`."
3. Distinguish broken-for-sure from possibly-timing.

Never say "looks good" without listing what you actually checked.

### 7. Clean up

```bash
kill "$(cat /tmp/preview.pid)" 2>/dev/null
supabase stop
rm -f e2e/walkthrough.spec.ts .env.local /tmp/preview.pid
git status --short   # sanity: confirm no stray files left
```

## Anti-patterns

- **Skipping mobile.** Half the recent visual regressions were mobile-only.
- **Only running the happy path.** Click the adjacent links — that's where regressions hide.
- **Hitting prod Supabase / Vercel.** Real `auth.users` rows, real cleanup burden, and Vercel deployment protection blocks unauthenticated headless browsers.
- **Trusting "test passed".** The spec asserts `expect(true).toBe(true)`; the screenshots are the actual verification.
- **Sending one screenshot.** Send the full set — the user spots inconsistencies you'll miss.
- **Punting on tooling errors.** "Docker isn't running, so I can't validate" is the wrong call — start the daemon. Bailing on the skill because step 1 of the prereqs needed a `sudo dockerd` is exactly the failure mode this skill exists to prevent.

## High-value spec patterns

When the feature involves a real interaction (file picker, drag/drop, paste,
focus/blur, form-state mutation), drive the actual interaction — don't stub it.
Unit tests can't catch state-management bugs that only show up when the
browser's own APIs are in the loop.

- **File pickers**: drive `setInputFiles` with real `Buffer` payloads. A 1×1
  PNG (89 hex bytes) is enough to satisfy MIME-type checks. Then assert the
  rendered list, not just the input. (A recent multi-photo PR shipped a
  live-FileList state bug that this exact assertion caught — typecheck and
  unit tests were green.)
- **Pickers that allow re-selection**: pick the same file again after
  removing it, to catch handlers that reset `input.value = ''` but capture the
  FileList asynchronously.
- **Lists with order**: append more items rather than picking once, to verify
  the handler dedupes / preserves order rather than replacing.

## Known sandbox gotchas

- `supabase start` without `-x edge-runtime,functions` fails with `error setting rlimit type 7: operation not permitted`. Always exclude those two.
- Moving the `supabase` binary out of its tarball directory breaks it — the shim resolves `supabase-go` relative to its own location.
- `dockerd` started by `sudo dockerd &` leaves no PID file; kill it on session teardown if you started it.
- Without `edge-runtime`/`functions`, the AI-driven import paths (URL, photo, Instagram) will surface backend errors. That's fine for validating the UI surface — stop short of submitting, or assert that the error toast appears. Don't conclude "the feature is broken".
