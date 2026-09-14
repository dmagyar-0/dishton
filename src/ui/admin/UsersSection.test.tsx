// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const query = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@/lib/queries/adminUsers', () => ({
  useAdminUsers: () => query,
}));

import { UsersSection } from './UsersSection';

describe('UsersSection', () => {
  it('renders an empty roster (brand-new install) without crashing', () => {
    query.data = [];
    render(<UsersSection />);
    expect(screen.getByText('admin.metrics.no_data')).toBeInTheDocument();
  });

  it('lists each user with their email', () => {
    query.data = [
      {
        profile_id: 'p1',
        email: 'someone@example.com',
        display_name: 'Someone',
        created_at: '2026-05-01T00:00:00Z',
        last_sign_in_at: '2026-09-01T12:00:00Z',
      },
    ];
    render(<UsersSection />);
    expect(screen.getByText('someone@example.com')).toBeInTheDocument();
    expect(screen.getByText('Someone')).toBeInTheDocument();
  });

  it('falls back to an em dash for a user with no display name or sign-in yet', () => {
    query.data = [
      {
        profile_id: 'p2',
        email: 'new@example.com',
        display_name: null,
        created_at: '2026-09-01T00:00:00Z',
        last_sign_in_at: null,
      },
    ];
    render(<UsersSection />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an error message when the RPC fails (e.g. not_app_admin)', () => {
    query.data = [];
    query.isError = true;
    render(<UsersSection />);
    expect(screen.getByText('admin.metrics.load_error')).toBeInTheDocument();
    query.isError = false;
  });
});
