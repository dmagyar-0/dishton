import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// i18n: echo the key so we can assert which copy renders.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// The members list is empty for these tests; we only care about the
// invite-generation affordance gating on isOwner.
const membersQuery = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
const invitesQuery = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
const createInvite = { mutateAsync: vi.fn(), isPending: false };

vi.mock('@/lib/queries/households', () => ({
  useHouseholdMembers: () => membersQuery,
  useHouseholdInvites: () => invitesQuery,
  useCreateInvite: () => createInvite,
  useChangeMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/queries/storage', () => ({
  useImageUrl: () => null,
}));

vi.mock('@/ui/primitives', async () => {
  const actual = await vi.importActual<typeof import('@/ui/primitives')>('@/ui/primitives');
  return { ...actual, useToast: () => ({ push: vi.fn() }) };
});

// Child dialogs pull in navigation + extra query hooks we don't exercise here.
vi.mock('./dialogs/InviteCodeDialog', () => ({ InviteCodeDialog: () => null }));
vi.mock('./dialogs/LeaveOrTransferDialog', () => ({ LeaveOrTransferDialog: () => null }));

import { MembersSection } from './MembersSection';

function renderSection(isOwner: boolean) {
  return render(
    <MembersSection
      householdId="h_1"
      selfProfileId="p_1"
      isOwner={isOwner}
      isSolo={false}
      onRequestDeleteHousehold={vi.fn()}
    />,
  );
}

describe('MembersSection invite gating', () => {
  it('shows the generate-invite button to owners', () => {
    renderSection(true);
    expect(
      screen.getByRole('button', { name: 'household_settings.members.generate_invite' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('household_settings.members.invite_owner_only'),
    ).not.toBeInTheDocument();
  });

  it('hides the generate-invite button from non-owners and explains why', () => {
    renderSection(false);
    expect(
      screen.queryByRole('button', { name: 'household_settings.members.generate_invite' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('household_settings.members.invite_owner_only')).toBeInTheDocument();
  });
});
