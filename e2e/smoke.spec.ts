// Single happy-path smoke covering signup → URL import → view.
//
// Since the personal-household redesign, a fresh signup lands directly
// on the user's "My Recipes" page — there is no /onboarding gate to
// pass.
//
// The AI call is mocked at the Edge Function boundary via AI_MOCK_MODE
// (set to 'playwright' in e2e.yml / locally), which the function reads from
// env and short-circuits to a canned fixture (see docs/12-testing-strategy.md
// and supabase/functions/_shared/ai/mock.ts).

import { expect, test } from '@playwright/test';

test.describe('dishton smoke', () => {
  test('signup → personal household → URL import → view', async ({ page }) => {
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL && !process.env.CI,
      'requires a running preview or local dev server',
    );

    const email = `test-${Date.now()}@dishton.test`;
    const password = 'test-password-1234';

    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.getByRole('link', { name: /create account/i }).click();
    await page.getByLabel(/display name/i).fill('Smoke Tester');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // The new flow drops onboarding entirely — every signup is greeted by
    // their personal household.
    await expect(page).toHaveURL(/\/h\//);

    // The top nav no longer carries an Import item (import now lives in the
    // floating "+" action on Home). On a fresh signup the pantry is empty, so
    // reach the import flow via the empty-state call-to-action. It renders as a
    // <button>, which disambiguates it from the floating "+" link that shares
    // the same accessible name ("Import a recipe").
    await page.getByRole('button', { name: 'Import a recipe' }).click();

    await page
      .getByPlaceholder(/example\.com\/recipe/i)
      .fill('https://example.test/tomato-tarte-tatin');
    await page.getByRole('button', { name: /^import$/i }).click();

    // Since #95, URL import runs in the background — the page does NOT auto-
    // navigate to the recipe. The kickoff returns immediately and the inline
    // import queue shows the in-progress item, labelled with the source host.
    await expect(page.getByRole('heading', { name: 'Imports in progress' })).toBeVisible();
    await expect(page.getByText('example.test')).toBeVisible();

    // When the background worker finishes, the SPA's realtime listener saves the
    // draft and it lands in the user's collection. In mock mode the importer
    // skips the network fetch and the AI returns the canned "Tomato Tarte Tatin"
    // draft, so that recipe shows up in the list. Hop back to "My Recipes" and
    // wait for it to appear.
    await page.getByRole('link', { name: 'My Recipes' }).click();
    const recipeCard = page.getByRole('link', { name: /tomato tarte tatin/i });
    await expect(recipeCard).toBeVisible({ timeout: 20_000 });

    // Opening it lands on the recipe detail page with the imported title as the
    // page heading.
    await recipeCard.click();
    await page.waitForURL(/\/h\/[^/]+\/r\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeVisible();
  });
});
