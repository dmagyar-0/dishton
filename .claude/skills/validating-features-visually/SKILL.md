---
name: validating-features-visually
description: Use after implementing or modifying any user-facing feature in Dishton, before claiming it complete. Dispatches a subagent that is handed the user's original intent and independently verifies it was actually delivered — building the SPA against local Supabase, driving Playwright through the flow plus adjacent surfaces, screenshotting at desktop and mobile viewports, and surfacing visual or behavioral regressions that typechecks and unit tests don't catch. Required by CLAUDE.md.
---

# Validating Features Visually

## Why this exists

Typecheck + unit tests catch code-correctness regressions. They do NOT catch:

- Flash-of-wrong-content from conditional renders that depend on multiple async queries (e.g. `isSolo` needing both `household.data` and memberships)
- Mobile layout overflow (chips, headers, modal codes)
- i18n keys rendering raw because a translation file lost a key
- Profile/auth fields populated from the wrong source post-signup
- Empty/loading states with stale or missing copy

PRs #61, #62, #63 all shipped through green CI and needed follow-up fixes because nobody opened the page in a browser before merging.

**Two problems this skill solves at once:**

1. **Nobody opens the page.** This makes "open the page" a deterministic, screenshot-capturing procedure.
2. **The author grades their own homework.** The agent that just wrote the code knows what it *intended* and reads screenshots through that bias — it sees what it meant to build, not what's on screen. So the validation runs in a **separate subagent** that is given the *user's intent* (what was asked for) and almost nothing about *how* it was implemented. The subagent's only job is: "Here's what the user wanted. Go confirm the running app delivers it." Fresh eyes, no implementation bias, and the screenshot-heavy work stays out of the main agent's context.

## The model: who does what

| Actor | Responsibility |
|---|---|
| **Main agent (you)** | Capture the user's intent + acceptance criteria. Dispatch ONE subagent (`general-purpose`) with that intent. Relay its verdict to the user. Do **not** run the procedure below yourself. |
| **Subagent** | Boot the stack, drive Playwright, screenshot, then judge each screenshot **against the intent it was given** — not against what looks plausible. Returns a per-criterion verdict + the screenshot paths. |

The split matters: the subagent should be able to find that the feature is *missing or wrong* without you having pre-decided it works. Don't leak "I implemented X by doing Y" into the prompt — leak only "the user wanted X; verify X."

## When to use

After any change that affects what the user sees: new route, new component, copy change, layout adjustment, conditional render based on backend state. Skip only for purely internal refactors (types, helper renames) where the rendered output cannot have changed.

## Step 1 (main agent) — distill the intent

Before dispatching, write down, in the user's terms, what *delivered* means. Pull this from the user's request and the conversation, NOT from your diff. Produce:

- **Intent**: one or two sentences — what the user asked for, in outcome terms ("a logged-in user can rename their household from Settings and the new name shows immediately in the header").
- **Acceptance criteria**: a checklist of observable, screenshot-checkable facts. Each must be verifiable by *looking*, e.g.:
  - "Settings shows a 'Household name' text field for household (non-solo) users."
  - "After saving, the header title updates to the new name without a reload."
  - "On a 390px viewport the field and Save button stay on screen, no overflow."
- **Where to enter the flow**: the route/click-path to reach the feature from a fresh signup.
- **Adjacent surfaces at risk**: anything the change could have dented (the nav targets, the home list, profile, etc.).

If the intent is genuinely ambiguous (you can't write criteria a stranger could check), ask the user with `AskUserQuestion` before dispatching — a subagent can't verify a vague goal.

## Step 2 (main agent) — dispatch the subagent

Call `Agent` with `subagent_type: "general-purpose"`. Use this prompt template, filling the bracketed parts. Note what it deliberately omits: your implementation approach.

```
You are independently verifying that a feature works in the running Dishton app.
You did NOT write this code. Your job is to confirm the app delivers the user's
intent — and to say so plainly if it does not. Do not assume it works.

USER'S INTENT
[one or two sentences, outcome terms]

ACCEPTANCE CRITERIA (verify each by looking at the running app)
[ ] [criterion 1]
[ ] [criterion 2]
[ ] ...

HOW TO REACH THE FEATURE
[route / click-path from a fresh signup]

ADJACENT SURFACES TO SPOT-CHECK FOR REGRESSIONS
[home list, nav targets, profile, settings, etc.]

PROCEDURE
Follow .claude/skills/validating-features-visually/SKILL.md, the "Subagent
procedure" section, exactly: boot the local stack, build + preview, drive
Playwright through signup → the flow above → adjacent surfaces, at desktop AND
390px mobile, screenshotting each meaningful state. Then Read every screenshot.

RETURN
For EACH acceptance criterion: PASS / FAIL / UNSURE, with the screenshot
filename that shows it and one line of what you observed (not what you expected).
Then: any regressions on adjacent surfaces, the list of screenshot paths under
/tmp/screenshots, and a final verdict (delivered / not delivered / partial).
Do not soften a FAIL into a PASS because it's "probably timing" — mark it UNSURE
and say why. Clean up the stack and the throwaway spec when done.
```

Run exactly one subagent for a given feature; don't fan out. When it returns, go to Step 3 (Relay).

---

## Subagent procedure

*(This section is for the dispatched subagent. The main agent does not run it.)*

### Prerequisites

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

If a step still fails after a real attempt, surface the actual error in your
report — don't silently fall back to "I'll let CI catch it".

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

For features whose write/read path runs entirely through Supabase RLS (e.g. the recipe-chat history sidebar), seed rows directly so the flow is exercisable without the Edge Functions the local stack can't run.

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

Drop the spec under `e2e/` so Playwright picks it up. The `e2e/walkthrough.spec.ts` name is fine for a throwaway; delete it during cleanup. Drive it through the **click-path you were given to reach the feature**, screenshotting each state named in the acceptance criteria — name screenshots after the criterion so you can map them back when judging.

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

  // ---- feature-specific flow goes here (the click-path from the prompt) ----
  await page.screenshot({ path: '/tmp/screenshots/01-feature-entry.png', fullPage: true });
  // ... navigate, interact, screenshot at each criterion-relevant state

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
  // here (PRs #61, #62). Re-walk the feature path here too, not just home.
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

### 5. Judge every screenshot against the intent

`Read` each PNG. Do not claim a feature works because the spec passed — the spec only asserts navigation; it doesn't see layout overflow, wrong copy, or wrong conditional render.

Go **criterion by criterion**. For each acceptance criterion you were given, find the screenshot that should show it and decide PASS / FAIL / UNSURE based on *what is actually rendered*, describing what you see rather than what you expected. A criterion with no screenshot that demonstrates it is a FAIL of the validation, not a PASS by assumption.

Then sweep these recurring trouble spots on the adjacent surfaces:

| Surface | What to verify |
|---|---|
| Recipe list (home) | `isSolo` rendering — solo users see "My Recipes" + "Welcome — let's fill the shelves", not "Recipes" + "Your pantry is empty". If desktop differs from mobile, you've caught a flash-of-wrong-content bug. |
| Settings | Solo vs household tabs — solo hides Members, Danger Zone, name editor; shows "This space is yours" + "When you want to share" callouts. |
| Profile | Display name field shows the name typed at signup, not the email's local-part. |
| Search | Has a real empty state (not a barren input on an empty page). |
| Mobile (390px) | Header icons fit on one row, no clipped content, invite codes wrap. |
| Any new route | Empty/loading states have copy, not blank cards. |

### 6. Clean up

```bash
kill "$(cat /tmp/preview.pid)" 2>/dev/null
supabase stop
rm -f e2e/walkthrough.spec.ts .env.local /tmp/preview.pid
git status --short   # sanity: confirm no stray files left
```

### 7. Return your verdict

Report back (to the main agent) in this shape:

1. **Per criterion**: PASS / FAIL / UNSURE + screenshot filename + one line of what you observed.
2. **Adjacent regressions**: anything off on the surfaces above.
3. **Screenshot paths**: the list under `/tmp/screenshots`.
4. **Final verdict**: delivered / partial / not delivered.

Never report "looks good" without the per-criterion table. Never upgrade a FAIL to PASS because it's "probably timing" — call it UNSURE and say what would resolve it.

---

## Step 3 (main agent) — relay to the user

When the subagent returns:

1. Send the screenshots via `SendUserFile` (the subagent leaves them at the returned paths; you forward them).
2. Lead with the **final verdict against the user's intent**: delivered / partial / not delivered, then the per-criterion results.
3. Frame uncertain items as the subagent did — observation + caveat, with a `file_path:line` pointer where relevant — not as a flat "works".
4. If the verdict is *not delivered* or *partial*, treat the feature as **not complete**: fix and re-dispatch, don't ship.

Never tell the user a feature is done on the strength of your own diff; the subagent's verdict against their intent is the gate.

## Anti-patterns

- **Running the procedure in the main agent.** That reintroduces author bias and floods your context with screenshots. Dispatch the subagent.
- **Leaking the implementation into the subagent prompt.** Give it the *intent*, not "I added a `useUpdateHousehold` mutation." It should be able to discover the feature is broken.
- **Vague acceptance criteria.** "The settings page looks right" isn't checkable. Each criterion must be confirmable from a screenshot.
- **Skipping mobile.** Half the recent visual regressions were mobile-only.
- **Only running the happy path.** Click the adjacent links — that's where regressions hide.
- **Hitting prod Supabase / Vercel.** Real `auth.users` rows, real cleanup burden, and Vercel deployment protection blocks unauthenticated headless browsers.
- **Trusting "test passed".** The spec asserts navigation; the screenshots judged against intent are the actual verification.
- **Sending one screenshot.** Send the full set — the user spots inconsistencies you'll miss.
- **Punting on tooling errors.** "Docker isn't running, so I can't validate" is the wrong call — start the daemon. Bailing because the prereqs needed a `sudo dockerd` is exactly the failure mode this skill exists to prevent.

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
