import { describe, expect, it } from 'vitest';
import { authErrorCopy } from './auth-errors';

describe('authErrorCopy', () => {
  it('maps known supabase messages to friendly copy', () => {
    expect(authErrorCopy('Invalid login credentials')).toBe(
      "That email and password didn't match.",
    );
    expect(authErrorCopy('User already registered')).toBe('That email already has an account.');
  });

  it('passes through unknown messages', () => {
    expect(authErrorCopy('Some other error')).toBe('Some other error');
  });

  it('returns a generic copy for null / undefined', () => {
    expect(authErrorCopy(null)).toBe('Something went wrong. Try again.');
    expect(authErrorCopy(undefined)).toBe('Something went wrong. Try again.');
    expect(authErrorCopy('')).toBe('Something went wrong. Try again.');
  });
});
