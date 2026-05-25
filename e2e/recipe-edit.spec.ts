// End-to-end coverage for the recipe-edit flow.
//
// Depends on the seeded `alice@example.test` user (`supabase/seed.sql`) who
// owns the Tomato Tarte Tatin recipe in The Pantry household. The local
// seed sets her password to `test1234` (8 chars), but the SPA login form
// requires >= 10 chars — this spec assumes a wrapper has bumped it (see
// the CLAUDE.md visual-validation skill, which runs:
//   update auth.users set encrypted_password = crypt('test-password-1234', ...)
// against the local DB). In CI, the same bump happens in the workflow.

import { expect, test } from '@playwright/test';

const PANTRY = '11111111-1111-1111-1111-111111111111';
const TARTE = '33333333-3333-3333-3333-333333333333';

test.describe('recipe edit', () => {
  test('signin → detail → edit → reorder + retitle → save → detail', async ({ page }) => {
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL && !process.env.CI,
      'requires a running preview / local Supabase',
    );

    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.getByLabel(/email/i).fill('alice@example.test');
    await page.getByLabel(/password/i).fill('test-password-1234');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/h\//, { timeout: 15_000 });

    await page.goto(`/h/${PANTRY}/r/${TARTE}`);
    await page.waitForLoadState('networkidle');

    const editLink = page.getByRole('link', { name: 'Edit recipe' });
    await expect(editLink).toBeVisible();
    await editLink.click();
    await page.waitForURL(/\/edit\/?$/);

    const titleInput = page.locator('label').filter({ hasText: 'Title' }).locator('input').first();
    await titleInput.fill('Tomato Tarte Tatin (revised)');

    // First visible "Move up" belongs to the 2nd ingredient row — the 1st
    // row's button is rendered but invisible (Playwright skips it).
    await page.getByRole('button', { name: 'Move up' }).first().click();

    // Bad quantity surfaces inline error, then we restore it.
    const firstQuantity = page.getByPlaceholder('e.g. 1 1/2').first();
    const originalQty = await firstQuantity.inputValue();
    await firstQuantity.fill('abc');
    await firstQuantity.blur();
    await expect(page.getByRole('alert')).toBeVisible();
    await firstQuantity.fill(originalQty);
    await firstQuantity.blur();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(/\/r\/[^/]+\/?$/, { timeout: 15_000 });

    await expect(
      page.getByRole('heading', { name: /tomato tarte tatin \(revised\)/i }),
    ).toBeVisible();
  });
});
