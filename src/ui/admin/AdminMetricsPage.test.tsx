// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
  }),
}));

const mocks = vi.hoisted(() => ({ emptyQuery: { data: [], isLoading: false, isError: false } }));

// Fully replaced (no importActual): the real module pulls in @/lib/auth ->
// ./i18n, which needs a full 'react-i18next' (initReactI18next included) --
// more than this smoke test's minimal useTranslation mock provides. A full
// stub sidesteps that chain entirely.
vi.mock('@/lib/queries/metrics', () => ({
  DATE_RANGE_OPTIONS: [7, 30, 90],
  dateRangeBounds: (days: number) => ({ from: `from-${days}`, to: 'to' }),
  useMetricsActiveUsers: () => mocks.emptyQuery,
  useMetricsAppOpens: () => mocks.emptyQuery,
  useMetricsImports: () => mocks.emptyQuery,
  useMetricsAiCost: () => mocks.emptyQuery,
  useMetricsEdgeFailures: () => mocks.emptyQuery,
  useMetricsStuckImports: () => mocks.emptyQuery,
}));

import { AdminMetricsPage } from './AdminMetricsPage';

// The dashboard's default state: a brand-new install with zero
// analytics_events, zero ai_usage rows, and zero import_jobs. Every section
// must render its empty state instead of crashing, dividing by zero, or
// leaking a NaN into the DOM.
describe('AdminMetricsPage', () => {
  it('renders every section with zero data across the board', () => {
    const { container } = render(<AdminMetricsPage />);
    expect(screen.getByText('admin.metrics.title')).toBeInTheDocument();
    expect(screen.getByText('admin.metrics.active_users.title')).toBeInTheDocument();
    expect(screen.getByText('admin.metrics.app_opens.title')).toBeInTheDocument();
    expect(screen.getByText('admin.metrics.imports.title')).toBeInTheDocument();
    expect(screen.getByText('admin.metrics.ai_cost.title')).toBeInTheDocument();
    expect(screen.getByText('admin.metrics.edge_reliability.title')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
    // No unpriced-calls warning with zero AI usage.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a 7/30/90-day range selector defaulting to 30d', () => {
    render(<AdminMetricsPage />);
    const group = screen.getByRole('group', { name: 'admin.metrics.date_range_label' });
    expect(group).toHaveTextContent('admin.metrics.date_range_days:7');
    expect(group).toHaveTextContent('admin.metrics.date_range_days:30');
    expect(group).toHaveTextContent('admin.metrics.date_range_days:90');
    expect(
      screen.getByRole('button', { name: 'admin.metrics.date_range_days:30' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
