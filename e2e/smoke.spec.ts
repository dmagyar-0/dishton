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

    // The recipe-list body also carries "Import" links (in a content <header>),
    // so target the nav link by its aria-label — only the nav link sets one, so
    // getByLabel is unambiguous on every viewport (it stays labelled even when
    // it renders icon-only on mobile).
    await page.getByLabel('Import', { exact: true }).click();

    await page
      .getByPlaceholder(/example\.com\/recipe/i)
      .fill('https://example.test/tomato-tarte-tatin');
    await page.getByRole('button', { name: /^import$/i }).click();

    // A successful import saves the recipe and navigates to its detail page.
    // In mock mode the importer skips the network fetch and the AI returns the
    // canned "Tomato Tarte Tatin" draft, so we land on the recipe with that
    // title as the page heading.
    await page.waitForURL(/\/h\/[^/]+\/r\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeVisible();
  });
});
