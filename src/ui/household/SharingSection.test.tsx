import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// i18n: echo the key so we can assert which copy renders.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const code = {
  code: 'f_LEBIJFTCMN6S',
  created_by: 'p_1',
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date().toISOString(),
};

const followCodesQuery = { data: [code], isLoading: false };
const followedQuery = { data: [], isLoading: false };
const followersQuery = { data: [], isLoading: false };

vi.mock('@/lib/queries/households', () => ({
  useHouseholdFollowCodes: () => followCodesQuery,
  useFollowedHouseholds: () => followedQuery,
  useFollowersOfHousehold: () => followersQuery,
  useCreateFollowCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeFollowCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const push = vi.fn();
vi.mock('@/ui/primitives', async () => {
  const actual = await vi.importActual<typeof import('@/ui/primitives')>('@/ui/primitives');
  return { ...actual, useToast: () => ({ push }) };
});

vi.mock('./dialogs/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { SharingSection } from './SharingSection';

describe('SharingSection follow code copy', () => {
  it('copies the code when the "tap to copy" hint is tapped', async () => {
    const user = userEvent.setup();
    render(<SharingSection householdId="h_1" isOwner={true} />);

    // The visible "Tap to copy" affordance must itself trigger the copy.
    await user.click(screen.getByText('household_settings.sharing.tap_to_copy'));

    await expect(navigator.clipboard.readText()).resolves.toBe(code.code);
  });
});
