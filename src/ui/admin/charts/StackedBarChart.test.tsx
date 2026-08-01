// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StackedBarChart } from './StackedBarChart';

describe('StackedBarChart', () => {
  it('renders an all-zero window without crashing, dividing by zero, or NaN', () => {
    const data = [
      {
        day: '2026-08-01',
        segments: [
          { key: 'standalone', label: 'Installed app', value: 0, color: '#e7993f' },
          { key: 'browser', label: 'Browser tab', value: 0, color: '#6b5341' },
        ],
      },
    ];
    const { container } = render(
      <StackedBarChart data={data} ariaLabel="App opens" emptyLabel="No data" />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders zero rows without crashing', () => {
    const { container } = render(
      <StackedBarChart data={[]} ariaLabel="App opens" emptyLabel="No data" />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('shows a legend once there are >=2 segment keys', () => {
    const data = [
      {
        day: '2026-08-01',
        segments: [
          { key: 'standalone', label: 'Installed app', value: 3, color: '#e7993f' },
          { key: 'browser', label: 'Browser tab', value: 5, color: '#6b5341' },
        ],
      },
    ];
    render(<StackedBarChart data={data} ariaLabel="App opens" emptyLabel="No data" />);
    expect(screen.getByText('Installed app')).toBeInTheDocument();
    expect(screen.getByText('Browser tab')).toBeInTheDocument();
  });
});
