// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const query = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/metrics', () => ({
  useMetricsActiveUsers: () => query,
}));

import { ActiveUsersSection } from './ActiveUsersSection';

const range = { from: '2026-07-01', to: '2026-08-01' };

describe('ActiveUsersSection', () => {
  it('renders zero DAU/WAU/MAU (brand-new install) without crashing', () => {
    query.data = [];
    const { container } = render(<ActiveUsersSection range={range} />);
    expect(screen.getAllByText('0')).not.toHaveLength(0);
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('shows an error message when the RPC fails (e.g. not_app_admin)', () => {
    query.data = [];
    query.isError = true;
    render(<ActiveUsersSection range={range} />);
    expect(screen.getByText('admin.metrics.load_error')).toBeInTheDocument();
    query.isError = false;
  });
});
