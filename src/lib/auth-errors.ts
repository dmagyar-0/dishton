// Map raw Supabase auth error messages to user-facing copy.

const MAP: Record<string, string> = {
  'Invalid login credentials': "That email and password didn't match.",
  'Email not confirmed': 'Confirm your email before signing in.',
  'User already registered': 'That email already has an account.',
  'Password should be at least 10 characters.': 'Use a password of at least 10 characters.',
};

export function authErrorCopy(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong. Try again.';
  return MAP[raw] ?? raw;
}
