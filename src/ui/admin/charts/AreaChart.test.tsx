// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AreaChart } from './AreaChart';

describe('AreaChart', () => {
  it('renders an all-zero USD window without crashing, dividing by zero, or NaN', () => {
    const data = [
      { day: '2026-07-31', value: 0 },
      { day: '2026-08-01', value: 0 },
    ];
    const { container } = render(
      <AreaChart
        data={data}
        color="#c46a2c"
        gridColor="#e0d2b6"
        surfaceColor="#efe3cd"
        ariaLabel="AI cost"
        emptyLabel="No data"
        formatValue={(v) => `$${v.toFixed(2)}`}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders zero rows without crashing', () => {
    const { container } = render(
      <AreaChart
        data={[]}
        color="#c46a2c"
        gridColor="#e0d2b6"
        surfaceColor="#efe3cd"
        ariaLabel="AI cost"
        emptyLabel="No data"
        formatValue={(v) => `$${v.toFixed(2)}`}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });
});
