// Design-snapshot capture spec — drives Playwright through EVERY Dishton route
// and interactive state, screenshotting each at the active project's viewport.
// playwright.config.ts runs this under both `chromium` (desktop) and
// `mobile-chrome` (Pixel 5), so every block is captured at desktop AND mobile.
//
// This is a SNAPSHOT tool, not an assertion suite: it must keep going and
// capture what is actually on screen even when an optional control is absent.
// So interactions are wrapped in `tap()` (no-op if not visible) and we never
// hard-fail on a missing element — the screenshots are the deliverable.
//
// Data comes from supabase/seed.sql (loaded by `supabase db reset`):
//   - alice@example.test owns "The Pantry" (a NON-solo household: Bob is an
//     editor) with several recipes across meal categories, a follow, and a
//     deterministic public share.
//   - A fresh signup gives the SOLO-household states.
// run.sh bumps alice's seed password to a >=10-char value before this runs.

import { expect, test } from '@playwright/test';

const OUT = process.env.SNAPSHOT_DIR ?? '/tmp/design-snapshot';
const PASSWORD = 'test-password-1234';

// Seeded, deterministic IDs (supabase/seed.sql).
const PANTRY = '11111111-1111-1111-1111-111111111111';
const TARTE = '33333333-3333-3333-3333-333333333333';
const SHARE_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function viewportDir(projectName: string): string {
  return projectName === 'mobile-chrome' ? 'mobile' : 'desktop';
}

// All snapshot blocks may run in parallel under each project; the household
// block must NOT persist mutations to the seed so reruns stay deterministic.
test.describe.configure({ mode: 'parallel' });

type Info = { project: { name: string } };

async function shot(page: import('@playwright/test').Page, info: Info, name: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // Small settle for animations/skeletons so we don't catch a half-rendered frame.
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `${OUT}/${viewportDir(info.project.name)}/${name}.png`,
    fullPage: true,
  });
}

/** Click a locator only if it's visible; report whether it fired. */
async function tap(locator: import('@playwright/test').Locator): Promise<boolean> {
  if (await locator.isVisible().catch(() => false)) {
    await locator.click().catch(() => {});
    return true;
  }
  return false;
}

async function signUp(page: import('@playwright/test').Page, name: string): Promise<string> {
  const email = `snapshot-${name}-${Date.now()}@dishton.test`;
  await page.goto('/');
  await page.getByRole('link', { name: /create account/i }).click();
  await page.getByLabel(/display name/i).fill('Design Snapshot');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/h\//, { timeout: 20_000 });
  const id = new URL(page.url()).pathname.split('/')[2] ?? '';
  return id;
}

async function signInAlice(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.getByLabel(/email/i).fill('alice@example.test');
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// 1. UNAUTHENTICATED surfaces — auth pages + the public, anon-readable surfaces.
// ---------------------------------------------------------------------------
test('snapshot: unauthenticated', async ({ page }, info) => {
  await page.goto('/auth/login');
  await shot(page, info, '00-auth-login');

  await page.goto('/auth/signup');
  await shot(page, info, '01-auth-signup');

  await page.goto('/auth/reset');
  await shot(page, info, '02-auth-reset');

  await page.goto('/auth/update-password');
  await shot(page, info, '03-auth-update-password');

  await page.goto('/onboarding');
  await shot(page, info, '04-onboarding');

  // Public share landing — active token (seeded) and a dead token (inactive state).
  await page.goto(`/r/${SHARE_TOKEN}`);
  await shot(page, info, '05-public-share-active');
  // Scale + unit toggle on the public page.
  await tap(page.getByRole('button', { name: /imperial/i }));
  await shot(page, info, '06-public-share-imperial');

  await page.goto('/r/deadbeefdeadbeefdeadbeefdeadbeef');
  await shot(page, info, '07-public-share-inactive');
});

// ---------------------------------------------------------------------------
// 2. SOLO user — every authenticated surface in the personal-household context.
// ---------------------------------------------------------------------------
test('snapshot: solo user', async ({ page }, info) => {
  const hid = await signUp(page, 'solo');

  await page.goto(`/h/${hid}/`);
  await shot(page, info, '10-home-empty-solo');

  await page.goto('/profile');
  await shot(page, info, '11-profile');

  // Import — every tab, plus a filled manual form.
  await page.goto(`/h/${hid}/import`);
  await shot(page, info, '12-import-url');
  await tap(page.getByRole('tab', { name: /photo/i }));
  await shot(page, info, '13-import-photo');
  await tap(page.getByRole('tab', { name: /manual/i }));
  await shot(page, info, '14-import-manual-empty');
  // Fill a little so the manual form's populated state is captured.
  await page
    .getByLabel(/title/i)
    .first()
    .fill('Weeknight Pasta')
    .catch(() => {});
  await page
    .getByLabel(/description/i)
    .first()
    .fill('A quick midweek dinner.')
    .catch(() => {});
  await shot(page, info, '15-import-manual-filled');
  await tap(page.getByRole('tab', { name: /draft|ai/i }));
  await shot(page, info, '16-import-draft-ai');

  // Settings — each tab a solo household exposes.
  await page.goto(`/h/${hid}/settings`);
  await shot(page, info, '17-settings-general-solo');
  for (const [i, name] of [
    [18, /invite|member/i],
    [20, /tags?/i],
  ] as const) {
    if (await tap(page.getByRole('tab', { name }))) {
      await shot(page, info, `${i}-settings-${String(name).replace(/[^a-z]/gi, '')}`);
    }
  }
  // Invite-code dialog open.
  if (await tap(page.getByRole('tab', { name: /invite|member/i }))) {
    await tap(page.getByRole('button', { name: /invite|generate|create code|new code/i }));
    await shot(page, info, '21-invite-code-dialog');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Households — the follow/sharing surface (moved off the Settings tab),
  // empty state for a fresh user.
  await page.goto('/households');
  await shot(page, info, '22-households-empty');
});

// ---------------------------------------------------------------------------
// 3. HOUSEHOLD user (alice) — populated list, recipe detail/edit, non-solo
//    settings (Members + Danger Zone), share dialog, populated following.
//    NOTE: never SAVE a mutation here — only open dialogs / fill-without-save —
//    so the seed stays deterministic across reruns.
// ---------------------------------------------------------------------------
test('snapshot: household user', async ({ page }, info) => {
  await signInAlice(page);

  // Recipe list with real recipes.
  await page.goto(`/h/${PANTRY}/`);
  await shot(page, info, '30-home-list');

  // Search — results then empty state.
  const search = page
    .getByRole('searchbox')
    .or(page.getByPlaceholder(/search/i))
    .first();
  await search.fill('tomato').catch(() => {});
  await shot(page, info, '31-search-results');
  await search.fill('zzznotarecipe').catch(() => {});
  await shot(page, info, '32-search-empty');
  await search.fill('').catch(() => {});

  // Meal-category tiles — pick a category to filter the list, then reset.
  if (await tap(page.getByRole('button', { name: 'Dinner' }).first())) {
    await shot(page, info, '33-home-category-filtered');
    await tap(page.getByRole('button', { name: 'All' }).first());
  }
  // Customize Home sheet — personalize which categories lead Home (5-cap).
  if (await tap(page.getByRole('button', { name: /customize/i }))) {
    await shot(page, info, '33b-customize-home-sheet');
    await page.keyboard.press('Escape').catch(() => {});
  }
  // In-search category filter sheet (the sliders button in the search bar).
  if (await tap(page.getByRole('button', { name: /filter recipes/i }))) {
    await shot(page, info, '33c-filter-sheet');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Recipe-card delete confirmation (open, then cancel — no mutation).
  if (await tap(page.getByRole('button', { name: /delete/i }).first())) {
    await shot(page, info, '34-delete-confirm');
    await tap(page.getByRole('button', { name: /cancel|keep|no/i }));
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Recipe detail — default, scaled, imperial, language toggle (if present).
  await page.goto(`/h/${PANTRY}/r/${TARTE}/`);
  await shot(page, info, '35-recipe-detail');
  await tap(page.getByRole('button', { name: /imperial/i }));
  await shot(page, info, '36-recipe-imperial');
  await tap(page.getByRole('button', { name: /metric/i }));
  // Bump servings to capture the scaled quantities.
  await tap(page.getByRole('button', { name: '8' }).first());
  await shot(page, info, '37-recipe-scaled');
  // Language toggle only renders when translations exist — capture it if shown.
  if (await tap(page.getByRole('button', { name: /language|deutsch|english|français/i }).first())) {
    await shot(page, info, '38-recipe-language');
  }

  // Share dialog (share is pre-enabled in seed → shows the public URL).
  if (await tap(page.getByRole('button', { name: /share/i }).first())) {
    await shot(page, info, '39-share-dialog');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Recipe edit — populated, then a validation/dirty state (never saved).
  await page.goto(`/h/${PANTRY}/r/${TARTE}/edit`);
  await shot(page, info, '40-recipe-edit');
  const qty = page.getByPlaceholder('e.g. 1 1/2').first();
  if (await qty.isVisible().catch(() => false)) {
    await qty.fill('abc');
    await qty.blur();
    await shot(page, info, '41-recipe-edit-validation');
  }

  // Settings — non-solo household exposes Members + Danger Zone + name editor.
  await page.goto(`/h/${PANTRY}/settings`);
  await shot(page, info, '42-settings-general');
  for (const [i, name] of [
    [43, /member/i],
    [45, /tags?/i],
  ] as const) {
    if (await tap(page.getByRole('tab', { name }))) {
      await shot(page, info, `${i}-settings-${String(name).replace(/[^a-z]/gi, '')}`);
    }
  }

  // Households — populated (The Pantry follows Carol's Kitchen in the seed).
  await page.goto('/households');
  await shot(page, info, '46-households-populated');
});
