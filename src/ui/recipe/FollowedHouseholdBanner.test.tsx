import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Interpolate {{name}} so the headline can be asserted end-to-end; everything
// else falls through to the key, which is enough to assert presence.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      key === 'following.browse_title' ? `${vars?.name}'s recipes` : key,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children?: ReactNode;
    to?: string;
    params?: Record<string, string>;
  }) => (
    <a href={`${to}:${params?.householdId ?? ''}`} data-testid="back-link">
      {children}
    </a>
  ),
}));

import { FollowedHouseholdBanner } from './FollowedHouseholdBanner';

describe('FollowedHouseholdBanner', () => {
  it('names the household being browsed', () => {
    render(<FollowedHouseholdBanner householdName="Carol's Kitchen" myHouseholdId="h1" />);
    expect(screen.getByText("Carol's Kitchen's recipes")).toBeInTheDocument();
  });

  it('says recipes here can be saved — the cue the bare card overlay never gave', () => {
    render(<FollowedHouseholdBanner householdName="Carol's Kitchen" myHouseholdId="h1" />);
    expect(screen.getByText('following.browse_help')).toBeInTheDocument();
  });

  it('links back to your own household when one is known', () => {
    render(<FollowedHouseholdBanner householdName="Carol's Kitchen" myHouseholdId="h1" />);
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/h/$householdId:h1');
  });

  it('falls back to a plain eyebrow when there is no household to go back to', () => {
    render(<FollowedHouseholdBanner householdName="Carol's Kitchen" />);
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    expect(screen.getByText('following.title')).toBeInTheDocument();
  });

  it('drops the save hint when saving is not available here', () => {
    render(
      <FollowedHouseholdBanner
        householdName="Carol's Kitchen"
        myHouseholdId="h1"
        canSave={false}
      />,
    );
    expect(screen.queryByText('following.browse_help')).not.toBeInTheDocument();
    // Still says whose kitchen this is, which is the point of the banner.
    expect(screen.getByText("Carol's Kitchen's recipes")).toBeInTheDocument();
  });

  it('renders an empty headline rather than "undefined" while the name loads', () => {
    const { container } = render(<FollowedHouseholdBanner myHouseholdId="h1" />);
    expect(container.querySelector('h1')?.textContent).toBe('');
  });
});
