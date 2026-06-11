// Public share landing surface: a logged-out visitor opens /r/<token> for the
// seeded share (supabase/seed.sql: Tomato Tarte Tatin with a fixed token) and
// sees the recipe plus the signup CTA. No auth, no AI — pure RLS/RPC path.

import { expect, test } from '@playwright/test';

const SHARE_URL = '/r/a1b2c3d4e5f60718293a4b5c6d7e8f90';

test.describe('public recipe share', () => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL && !process.env.CI,
    'requires a running preview or local dev server',
  );

  test('share link renders the recipe without auth', async ({ page }) => {
    await page.goto(SHARE_URL);
    await expect(page.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeVisible();
    await expect(page.getByText('cherry tomatoes')).toBeVisible();
    await expect(page.getByRole('link', { name: /start your own pantry/i }).first()).toBeVisible();
  });

  test('an unknown token shows the inactive state', async ({ page }) => {
    await page.goto('/r/deaddeaddeaddeaddeaddeaddeaddead');
    await expect(page.getByText(/no longer active/i)).toBeVisible();
  });
});
