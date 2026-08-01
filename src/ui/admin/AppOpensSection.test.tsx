// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const query = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/metrics', () => ({
  useMetricsAppOpens: () => query,
}));

import { AppOpensSection } from './AppOpensSection';

const range = { from: '2026-07-01', to: '2026-08-01' };

describe('AppOpensSection', () => {
  it('renders zero opens without crashing or dividing by zero for the standalone share', () => {
    query.data = [];
    const { container } = render(<AppOpensSection range={range} />);
    // 0 opens -> the standalone-share percentage must fall back to 0, not NaN.
    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByText(/standalone_share/)).toHaveTextContent('"percent":0');
  });
});
