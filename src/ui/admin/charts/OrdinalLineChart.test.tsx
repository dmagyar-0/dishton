// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrdinalLineChart } from './OrdinalLineChart';

const series = [
  { key: 'dau', label: 'Daily' },
  { key: 'wau', label: 'Weekly' },
  { key: 'mau', label: 'Monthly' },
];

describe('OrdinalLineChart', () => {
  // A brand-new install has zero analytics_events -- every day in range comes
  // back from metrics_active_users with dau=wau=mau=0. The chart must not
  // divide by zero, render NaN into the SVG, or throw.
  it('renders an empty-data window without crashing or producing NaN', () => {
    const data = [
      { day: '2026-07-30', values: [0, 0, 0] },
      { day: '2026-07-31', values: [0, 0, 0] },
      { day: '2026-08-01', values: [0, 0, 0] },
    ];
    const { container } = render(
      <OrdinalLineChart
        data={data}
        series={series}
        ariaLabel="Active users"
        emptyLabel="No data"
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders zero rows (no date range data at all) without crashing', () => {
    const { container } = render(
      <OrdinalLineChart data={[]} series={series} ariaLabel="Active users" emptyLabel="No data" />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders real data with distinct polylines per series', () => {
    const data = [
      { day: '2026-07-30', values: [1, 2, 4] },
      { day: '2026-07-31', values: [2, 3, 5] },
      { day: '2026-08-01', values: [3, 4, 6] },
    ];
    const { container } = render(
      <OrdinalLineChart
        data={data}
        series={series}
        ariaLabel="Active users"
        emptyLabel="No data"
      />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
    expect(container.innerHTML).not.toContain('NaN');
  });
});
