// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const edgeQuery = { data: [] as unknown[], isLoading: false, isError: false };
const stuckQuery = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/metrics', () => ({
  useMetricsEdgeFailures: () => edgeQuery,
  useMetricsStuckImports: () => stuckQuery,
}));

import { EdgeReliabilitySection } from './EdgeReliabilitySection';

const range = { from: '2026-07-01', to: '2026-08-01' };

describe('EdgeReliabilitySection', () => {
  it('renders with zero edge_call events and zero stuck imports without crashing', () => {
    edgeQuery.data = [];
    stuckQuery.data = [];
    const { container } = render(<EdgeReliabilitySection range={range} />);
    expect(screen.getByText('admin.metrics.edge_reliability.no_stuck_imports')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('lists stuck imports when present', () => {
    edgeQuery.data = [];
    stuckQuery.data = [
      {
        id: 'j_1',
        profile_id: 'p_1',
        household_id: 'h_1',
        kind: 'url',
        status: 'running',
        created_at: '2026-08-01T00:00:00Z',
        age_minutes: 42,
      },
    ];
    render(<EdgeReliabilitySection range={range} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
