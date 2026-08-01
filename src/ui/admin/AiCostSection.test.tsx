// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

const query = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/metrics', () => ({
  useMetricsAiCost: () => query,
}));

import { AiCostSection } from './AiCostSection';

const range = { from: '2026-07-01', to: '2026-08-01' };

describe('AiCostSection', () => {
  it('renders an empty AI-usage window (brand-new install) without crashing', () => {
    query.data = [];
    query.isLoading = false;
    query.isError = false;
    const { container } = render(<AiCostSection range={range} />);
    expect(container.innerHTML).not.toContain('NaN');
    // No unpriced-calls warning when there is nothing to warn about.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the unpriced-calls warning when unpriced_calls > 0', () => {
    query.data = [
      {
        day: '2026-08-01',
        function: 'import-url',
        model: 'claude-future-6',
        calls: 4,
        tokens_in: 1000,
        tokens_out: 200,
        cache_read: 0,
        cache_write: 0,
        usd: 0,
        unpriced_calls: 4,
      },
    ];
    render(<AiCostSection range={range} />);
    expect(screen.getByRole('alert')).toHaveTextContent('admin.metrics.ai_cost.unpriced_warning:4');
  });

  it('does not show the warning when every call was priced', () => {
    query.data = [
      {
        day: '2026-08-01',
        function: 'import-url',
        model: 'claude-sonnet-5',
        calls: 4,
        tokens_in: 1000,
        tokens_out: 200,
        cache_read: 0,
        cache_write: 0,
        usd: 0.01,
        unpriced_calls: 0,
      },
    ];
    render(<AiCostSection range={range} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
