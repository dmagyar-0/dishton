import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// i18n: resolve the period sub-keys and interpolate {{period}}/{{name}} so the
// rendered eyebrow can be asserted end-to-end. Trans renders the question with
// its highlighted segment for the cooking word.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const periods: Record<string, string> = {
        'home.period_morning': 'morning',
        'home.period_afternoon': 'afternoon',
        'home.period_evening': 'evening',
      };
      if (key in periods) return periods[key];
      if (key === 'home.greeting') return `Good ${vars?.period}, ${vars?.name}`;
      if (key === 'home.greeting_noname') return `Good ${vars?.period}`;
      return key;
    },
  }),
  Trans: () => <span>What would you like to cook today?</span>,
}));

let displayName: string | undefined = 'Ada Lovelace';
vi.mock('@/lib/auth', () => ({
  useAuth: (selector: (s: { profile: { display_name: string } | null }) => unknown) =>
    selector({ profile: displayName === undefined ? null : { display_name: displayName } }),
}));

import { HomeGreeting } from './HomeGreeting';

function setHour(hour: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 21, hour, 0, 0));
}

describe('HomeGreeting', () => {
  afterEach(() => {
    vi.useRealTimers();
    displayName = 'Ada Lovelace';
  });

  it('greets with morning before noon and only the first name', () => {
    setHour(8);
    render(<HomeGreeting />);
    expect(screen.getByText('Good morning, Ada')).toBeInTheDocument();
  });

  it('greets with afternoon between noon and 6pm', () => {
    setHour(14);
    render(<HomeGreeting />);
    expect(screen.getByText('Good afternoon, Ada')).toBeInTheDocument();
  });

  it('greets with evening from 6pm onward', () => {
    setHour(20);
    render(<HomeGreeting />);
    expect(screen.getByText('Good evening, Ada')).toBeInTheDocument();
  });

  it('treats noon as afternoon (boundary)', () => {
    setHour(12);
    render(<HomeGreeting />);
    expect(screen.getByText('Good afternoon, Ada')).toBeInTheDocument();
  });

  it('drops the name suffix when the profile has no display name', () => {
    displayName = '';
    setHour(9);
    render(<HomeGreeting />);
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('drops the name suffix when there is no profile at all', () => {
    displayName = undefined;
    setHour(9);
    render(<HomeGreeting />);
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('prefers an explicit name prop over the profile name', () => {
    setHour(9);
    render(<HomeGreeting name="Grace Hopper" />);
    expect(screen.getByText('Good morning, Grace')).toBeInTheDocument();
  });

  it('renders the cook question headline', () => {
    setHour(9);
    render(<HomeGreeting />);
    expect(screen.getByText('What would you like to cook today?')).toBeInTheDocument();
  });
});
