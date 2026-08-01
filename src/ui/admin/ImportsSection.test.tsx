// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const query = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/metrics', () => ({
  useMetricsImports: () => query,
}));

import { ImportsSection } from './ImportsSection';

const range = { from: '2026-07-01', to: '2026-08-01' };

describe('ImportsSection', () => {
  it('renders zero imports (no terminal jobs yet) without crashing', () => {
    query.data = [];
    const { container } = render(<ImportsSection range={range} />);
    // No succeeded+failed -> success rate and p95 must render the "no data"
    // dash, not NaN% / NaN ms.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('computes an aggregate success rate and p95 across kinds', () => {
    query.data = [
      {
        day: '2026-07-31',
        kind: 'url',
        started: 10,
        succeeded: 8,
        failed: 2,
        p50_ms: 800,
        p95_ms: 1500,
      },
      {
        day: '2026-08-01',
        kind: 'photo',
        started: 4,
        succeeded: 4,
        failed: 0,
        p50_ms: 2000,
        p95_ms: 3000,
      },
    ];
    render(<ImportsSection range={range} />);
    // 12 succeeded out of 14 terminal -> 86%.
    expect(screen.getByText('86%')).toBeInTheDocument();
  });
});
