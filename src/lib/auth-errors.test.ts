import { describe, expect, it, vi } from 'vitest';

vi.mock('@/observability/sentry', () => ({
  logErrorBreadcrumb: vi.fn(),
}));

import { authErrorCopy } from './auth-errors';

describe('authErrorCopy', () => {
  it('maps known supabase messages to friendly copy', () => {
    expect(authErrorCopy('Invalid login credentials')).toBe(
      "That email and password didn't match.",
    );
    expect(authErrorCopy('User already registered')).toBe('That email already has an account.');
  });

  it('returns a generic copy for unmapped messages instead of leaking raw text', () => {
    // Raw Postgres/Supabase internals must never reach the user.
    expect(authErrorCopy('relation "x" does not exist')).toBe('Something went wrong. Try again.');
    expect(authErrorCopy('Some other error')).toBe('Something went wrong. Try again.');
  });

  it('returns a generic copy for null / undefined', () => {
    expect(authErrorCopy(null)).toBe('Something went wrong. Try again.');
    expect(authErrorCopy(undefined)).toBe('Something went wrong. Try again.');
    expect(authErrorCopy('')).toBe('Something went wrong. Try again.');
  });
});
