// Household member management happy path:
//   owner signs up → generates invite from their (solo) personal household
//   → guest signs up → guest redeems invite, merging into owner's household
//   → owner promotes guest → guest leaves without taking recipes.
//
// The test runs in two browser contexts so each user has independent storage
// state. Like smoke.spec.ts, it is skipped without PLAYWRIGHT_BASE_URL or CI.

import { expect, test } from '@playwright/test';

test.describe('household member management', () => {
  test('invite, redeem (merge), promote, leave', async ({ browser }) => {
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL && !process.env.CI,
      'requires a running preview or local dev server',
    );

    const stamp = Date.now();
    const ownerName = `owner-${stamp}`;
    const guestName = `guest-${stamp}`;
    const ownerEmail = `${ownerName}@dishton.test`;
    const guestEmail = `${guestName}@dishton.test`;
    const password = 'test-password-1234';
    // NB: the handle_new_user trigger uses the email prefix as the initial
    // display_name and ignores the value entered in the signup form.

    // Owner signs up and lands directly in their personal household.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/');
    await ownerPage.getByRole('link', { name: /create account/i }).click();
    await ownerPage.getByLabel(/display name/i).fill(ownerName);
    await ownerPage.getByLabel(/email/i).fill(ownerEmail);
    await ownerPage.getByLabel(/password/i).fill(password);
    await ownerPage.getByRole('button', { name: /create account/i }).click();
    await expect(ownerPage).toHaveURL(/\/h\//);

    // Settings → Invite tab (renamed from Members in solo mode) → generate.
    await ownerPage.getByRole('link', { name: /settings/i }).click();
    await ownerPage.getByRole('tab', { name: /invite|members/i }).click();
    await ownerPage.getByRole('button', { name: /generate invite/i }).click();

    const codeNode = ownerPage.locator('[aria-label="Copy code"]').first();
    await expect(codeNode).toBeVisible();
    const code = ((await codeNode.textContent()) ?? '').trim();
    expect(code).toMatch(/^[A-Z2-7]{8}$/);

    // Guest signs up; also lands in a personal household.
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();
    await guestPage.goto('/auth/signup');
    await guestPage.getByLabel(/display name/i).fill(guestName);
    await guestPage.getByLabel(/email/i).fill(guestEmail);
    await guestPage.getByLabel(/password/i).fill(password);
    await guestPage.getByRole('button', { name: /create account/i }).click();
    await expect(guestPage).toHaveURL(/\/h\//);

    // Follow the share link — redeem moves guest into owner's household
    // and removes the guest's personal household.
    await guestPage.goto(`/onboarding?code=${code}`);
    await expect(guestPage.getByText(/prefilled/i)).toBeVisible();
    await guestPage.getByRole('button', { name: /^join$/i }).click();
    await expect(guestPage).toHaveURL(/\/h\//);

    // Owner refreshes members tab and promotes the guest.
    await ownerPage.reload();
    await expect(ownerPage.getByText(guestName)).toBeVisible();
    await ownerPage
      .getByLabel(/promote to owner/i)
      .first()
      .click();
    await ownerPage.getByRole('button', { name: /^promote$/i }).click();
    await expect(ownerPage.getByText('Editor', { exact: true })).toHaveCount(0);

    // Guest (now an owner) leaves; pick "Leave without recipes" so we
    // exercise the legacy leave_household path. Since there is still
    // another owner this succeeds without entering the transfer flow.
    await guestPage.getByRole('link', { name: /settings/i }).click();
    await guestPage.getByRole('tab', { name: /members/i }).click();
    await guestPage.getByRole('button', { name: /leave household/i }).click();
    await guestPage.getByRole('button', { name: /leave without recipes/i }).click();
    // Guest is bounced to the root which resolves to a fresh personal hh.
    await expect(guestPage).toHaveURL(/\/h\//);

    // Owner sees the guest gone.
    await ownerPage.reload();
    await expect(ownerPage.getByText(guestName)).toHaveCount(0);

    await guestCtx.close();
    await ownerCtx.close();
  });
});
