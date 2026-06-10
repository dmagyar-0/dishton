// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// i18n: echo keys so assertions are bundle-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stable memberships for most tests — one personal household (solo).
const SOLO_MEMBERSHIP = [{ household_id: 'h-test', is_personal: true }];
// Two memberships: personal + shared → isSolo=false.
const SHARED_MEMBERSHIPS = [
  { household_id: 'h-personal', is_personal: true },
  { household_id: 'h-shared', is_personal: false },
];

// Mutable so individual tests can override.
let mockMemberships = SOLO_MEMBERSHIP;
let mockFollowsEnabled = false;

vi.mock('@/lib/auth', () => ({
  useAuth: (selector: (s: { memberships: typeof SOLO_MEMBERSHIP }) => unknown) =>
    selector({ memberships: mockMemberships }),
}));

vi.mock('@/feature-flags', () => ({
  useFeatureFlag: (_key: string) => mockFollowsEnabled,
}));

// ActiveImportsIndicator uses its own hooks — stub it out.
vi.mock('@/ui/shell/ActiveImportsIndicator', () => ({
  ActiveImportsIndicator: () => <div data-testid="active-imports-indicator" />,
}));

// TanStack Router: Link renders a plain <a>, Outlet renders nothing.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    'aria-label': ariaLabel,
    to,
  }: {
    children?: React.ReactNode;
    'aria-label'?: string;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
    activeProps?: Record<string, string>;
    inactiveProps?: Record<string, string>;
    activeOptions?: Record<string, boolean>;
  }) => (
    <a href={to} aria-label={ariaLabel}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
}));

import { AppShell } from './AppShell';

describe('AppShell — solo user (one personal household)', () => {
  beforeEach(() => {
    mockMemberships = SOLO_MEMBERSHIP;
    mockFollowsEnabled = false;
  });

  it('renders the Dishton wordmark in the top bar', () => {
    render(<AppShell />);
    // The wordmark Link has no aria-label; match by text content.
    expect(screen.getByText('app.name')).toBeInTheDocument();
  });

  it('renders the Settings link in the top bar', () => {
    render(<AppShell />);
    expect(screen.getByLabelText('nav.household_settings')).toBeInTheDocument();
  });

  it('does NOT render the Following link when follows_enabled is off', () => {
    render(<AppShell />);
    expect(screen.queryByLabelText('nav.following')).not.toBeInTheDocument();
  });

  it('renders the ActiveImportsIndicator in the top bar', () => {
    render(<AppShell />);
    expect(screen.getByTestId('active-imports-indicator')).toBeInTheDocument();
  });

  it('renders the bottom tab bar with exactly 5 labeled items', () => {
    render(<AppShell />);
    // Scope to the bottom tab bar landmark by its aria-label (i18n key echoed).
    const tabBar = screen.getByRole('navigation', { name: 'nav.tab_bar_label' });
    const links = within(tabBar).getAllByRole('link');
    expect(links).toHaveLength(5);
    // Verify each expected label is present within the tab bar.
    const tabLabels = [
      'nav.my_recipes', // solo label for Home
      'search.nav',
      'nav.import',
      'chat.nav',
      'nav.profile',
    ];
    for (const label of tabLabels) {
      expect(within(tabBar).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('bottom tab bar label text (spans) are visible in the DOM', () => {
    render(<AppShell />);
    // Spans inside tab items carry the visible label text.
    // With i18n echoing keys, these match the translation keys.
    const tabBar = screen.getByRole('navigation', { name: 'nav.tab_bar_label' });
    expect(within(tabBar).getAllByText('nav.my_recipes')).toHaveLength(1);
    expect(within(tabBar).getAllByText('search.nav')).toHaveLength(1);
    expect(within(tabBar).getAllByText('nav.import')).toHaveLength(1);
    expect(within(tabBar).getAllByText('chat.nav')).toHaveLength(1);
    expect(within(tabBar).getAllByText('nav.profile')).toHaveLength(1);
  });
});

describe('AppShell — shared household (isSolo=false)', () => {
  beforeEach(() => {
    mockMemberships = SHARED_MEMBERSHIPS;
    mockFollowsEnabled = false;
  });

  it('uses nav.home label (not nav.my_recipes) in the bottom tab bar', () => {
    render(<AppShell />);
    // With two memberships, isSolo is false → label is 'nav.home'.
    const homeLinks = screen.getAllByLabelText('nav.home');
    expect(homeLinks.length).toBeGreaterThanOrEqual(1);
    // nav.my_recipes must NOT appear at all.
    expect(screen.queryByLabelText('nav.my_recipes')).not.toBeInTheDocument();
  });
});

describe('AppShell — follows_enabled flag', () => {
  beforeEach(() => {
    mockMemberships = SOLO_MEMBERSHIP;
    mockFollowsEnabled = true;
  });

  it('renders the Following link when follows_enabled is on', () => {
    render(<AppShell />);
    expect(screen.getByLabelText('nav.following')).toBeInTheDocument();
  });
});

describe('AppShell — no household yet (empty memberships)', () => {
  beforeEach(() => {
    mockMemberships = [];
    mockFollowsEnabled = false;
  });

  it('still renders the wordmark and Settings is absent without a householdId', () => {
    render(<AppShell />);
    expect(screen.getByText('app.name')).toBeInTheDocument();
    expect(screen.queryByLabelText('nav.household_settings')).not.toBeInTheDocument();
  });

  it('renders bottom tab bar with only Search and Profile (no household-dependent items)', () => {
    render(<AppShell />);
    const tabBar = screen.getByRole('navigation', { name: 'nav.tab_bar_label' });
    const tabLinks = within(tabBar).getAllByRole('link');
    expect(tabLinks).toHaveLength(2);
    expect(within(tabBar).getByLabelText('search.nav')).toBeInTheDocument();
    expect(within(tabBar).getByLabelText('nav.profile')).toBeInTheDocument();
  });
});
