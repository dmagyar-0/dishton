// Single happy-path smoke covering signup → URL import → view.
//
// Since the personal-household redesign, a fresh signup lands directly
// on the user's "My Recipes" page — there is no /onboarding gate to
// pass.
//
// NIM is mocked at the Edge Function boundary via NIM_MOCK_MODE=playwright,
// which the function reads from env (see docs/12-testing-strategy.md).

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

    await page.getByRole('link', { name: /import/i }).click();

    await page
      .getByPlaceholder(/example\.com\/recipe/i)
      .fill('https://example.test/tomato-tarte-tatin');
    await page.getByRole('button', { name: /^import$/i }).click();

    // Draft preview JSON should land in the page; from there the user moves
    // to a draft-edit modal in a follow-up flow.
    await expect(page.locator('pre')).toContainText('Tomato Tarte Tatin');
  });
});
