// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// i18n: echo keys so assertions are bundle-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

// Feature flag is toggled per-test via this mutable holder. `resolved` models
// the runtime-flag loading window: until the DB read returns, the gate must not
// act on the default-off value.
const flag = { enabled: true, resolved: true };
vi.mock('@/feature-flags', () => ({
  useFeatureFlag: () => flag.enabled,
  useFeatureFlagStatus: () => ({ enabled: flag.enabled, isResolved: flag.resolved }),
}));

// redirect() throws in the real router; mock it to a recognisable sentinel so
// the gate's redirect path is observable without a router context.
const REDIRECT = Symbol('redirect');
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  redirect: vi.fn(() => {
    throw REDIRECT;
  }),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../_guards', () => ({ requireAuth: vi.fn() }));

// Auth: a single personal household membership.
vi.mock('@/lib/auth', () => ({
  useAuth: (selector: (s: unknown) => unknown) =>
    selector({
      memberships: [{ household_id: 'h-personal', role: 'owner', is_personal: true }],
    }),
}));

vi.mock('@/lib/queries/households', () => ({
  useFollowedHouseholds: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useAddFollow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/forms/household', () => ({
  AddFollowSchema: {},
}));

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => () => ({ values: {}, errors: {} }),
}));

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    handleSubmit: (fn: (v: unknown) => void) => (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      return fn({ code: '' });
    },
    register: () => ({}),
    reset: vi.fn(),
    formState: { errors: {} },
  }),
}));

vi.mock('@/ui/primitives', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  EmptyState: ({ title }: { title?: React.ReactNode }) => <div>{title}</div>,
  Skeleton: () => <div />,
  useToast: () => ({ push: vi.fn() }),
}));

vi.mock('@/ui/primitives/Input', () => ({ Input: () => <input /> }));
vi.mock('@/ui/household/translateError', () => ({ translateHouseholdError: () => '' }));
vi.mock('@/ui/household/dialogs/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { FollowingGate } from './index';

afterEach(() => {
  flag.enabled = true;
  flag.resolved = true;
});

describe('FollowingGate (follows_enabled flag)', () => {
  it('renders the following page when the flag is on', () => {
    flag.enabled = true;
    render(<FollowingGate />);
    expect(screen.getByText('following.title')).toBeInTheDocument();
  });

  it('redirects (throws) when the flag is off', () => {
    flag.enabled = false;
    expect(() => render(<FollowingGate />)).toThrow();
  });

  it('waits (no redirect) while the flag is still resolving', () => {
    // Default-off value is in effect during the loading window; the gate must
    // not redirect/throw until the real value is known, or a cold page load
    // trips the error boundary.
    flag.enabled = false;
    flag.resolved = false;
    expect(() => render(<FollowingGate />)).not.toThrow();
    expect(screen.queryByText('following.title')).not.toBeInTheDocument();
  });
});
