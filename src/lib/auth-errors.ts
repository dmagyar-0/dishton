// Map raw Supabase auth error messages to user-facing copy.

import { logErrorBreadcrumb } from '@/observability/sentry';

const MAP: Record<string, string> = {
  'Invalid login credentials': "That email and password didn't match.",
  'Email not confirmed': 'Confirm your email before signing in.',
  'User already registered': 'That email already has an account.',
  'Password should be at least 10 characters.': 'Use a password of at least 10 characters.',
};

const GENERIC = 'Something went wrong. Try again.';

export function authErrorCopy(raw: string | null | undefined): string {
  if (!raw) return GENERIC;
  const mapped = MAP[raw];
  if (mapped) return mapped;
  // Unmapped: don't leak the raw Supabase/Postgres string to the user. Keep it
  // as a breadcrumb so it's still debuggable in Sentry.
  logErrorBreadcrumb('unmapped auth error', { raw });
  return GENERIC;
}
