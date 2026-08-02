import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}::${Object.values(vars).join(',')}` : key,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children?: ReactNode;
    to?: string;
    search?: Record<string, string>;
  }) => (
    <a href={`${typeof to === 'string' ? to : '#'}${search ? `?next=${search.next}` : ''}`}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

const navigateMock = vi.fn();

let sessionValue: { user: { id: string } } | null = null;
let membershipsValue: Array<{
  household_id: string;
  role: 'owner' | 'editor';
  is_personal: boolean;
}> = [];
let hydratedValue = true;

vi.mock('@/lib/auth', () => ({
  useAuth: (selector: (s: unknown) => unknown) =>
    selector({ session: sessionValue, memberships: membershipsValue, hydrated: hydratedValue }),
}));

let peekData: { household_id: string; household_name: string } | null = null;
let peekLoading = false;
let followedData: Array<{ followed_household_id: string }> = [];
let followedLoading = false;
const addFollowMutateAsync = vi.fn();

vi.mock('@/lib/queries/households', () => ({
  usePeekFollowCode: () => ({ data: peekData, isLoading: peekLoading }),
  useFollowedHouseholds: () => ({ data: followedData, isLoading: followedLoading }),
  useAddFollow: () => ({ mutateAsync: addFollowMutateAsync, isPending: false }),
}));

const push = vi.fn();
vi.mock('@/ui/primitives', async () => {
  const actual = await vi.importActual<typeof import('@/ui/primitives')>('@/ui/primitives');
  return { ...actual, useToast: () => ({ push }) };
});

import { FollowLinkPage } from './FollowLinkPage';

const CODE = 'f_LEBIJFTCMN6S';

function reset() {
  sessionValue = null;
  membershipsValue = [];
  hydratedValue = true;
  peekData = null;
  peekLoading = false;
  followedData = [];
  followedLoading = false;
  addFollowMutateAsync.mockReset().mockResolvedValue('followed-id');
  navigateMock.mockReset();
  push.mockReset();
}

describe('FollowLinkPage', () => {
  it('shows the invalid state for an unknown/expired/revoked code', () => {
    reset();
    peekData = null;
    render(<FollowLinkPage code={CODE} />);
    expect(screen.getByText('follow_link.invalid_title')).toBeInTheDocument();
  });

  it('offers sign up / log in, both carrying next, when signed out', () => {
    reset();
    peekData = { household_id: 'h_carol', household_name: "Carol's Kitchen" };
    sessionValue = null;
    render(<FollowLinkPage code={CODE} />);

    expect(screen.getByText(`follow_link.heading::Carol's Kitchen`)).toBeInTheDocument();
    const signup = screen.getByText('follow_link.signup_action').closest('a');
    const login = screen.getByText('follow_link.login_action').closest('a');
    expect(signup?.getAttribute('href')).toBe(`/auth/signup?next=/f/${CODE}`);
    expect(login?.getAttribute('href')).toBe(`/auth/login?next=/f/${CODE}`);
  });

  it('offers a Follow button when signed in and not yet following', async () => {
    reset();
    peekData = { household_id: 'h_carol', household_name: "Carol's Kitchen" };
    sessionValue = { user: { id: 'u1' } };
    membershipsValue = [{ household_id: 'h_mine', role: 'owner', is_personal: true }];
    followedData = [];

    const user = userEvent.setup();
    render(<FollowLinkPage code={CODE} />);

    const button = screen.getByRole('button', { name: 'follow_link.follow_action' });
    await user.click(button);
    expect(addFollowMutateAsync).toHaveBeenCalledWith(CODE);
  });

  it('shows "already following" when the caller already follows the household', () => {
    reset();
    peekData = { household_id: 'h_carol', household_name: "Carol's Kitchen" };
    sessionValue = { user: { id: 'u1' } };
    membershipsValue = [{ household_id: 'h_mine', role: 'owner', is_personal: true }];
    followedData = [{ followed_household_id: 'h_carol' }];

    render(<FollowLinkPage code={CODE} />);
    expect(screen.getByText(`follow_link.already_title::Carol's Kitchen`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'follow_link.follow_action' })).toBeNull();
  });

  it('shows the own-household state when the code belongs to the caller', () => {
    reset();
    peekData = { household_id: 'h_mine', household_name: 'My Kitchen' };
    sessionValue = { user: { id: 'u1' } };
    membershipsValue = [{ household_id: 'h_mine', role: 'owner', is_personal: true }];

    render(<FollowLinkPage code={CODE} />);
    expect(screen.getByText('follow_link.own_title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'follow_link.follow_action' })).toBeNull();
  });
});
