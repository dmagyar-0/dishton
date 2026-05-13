// Maps a Supabase RPC error to a friendly translation key.
// The Postgres functions raise short snake_case messages like 'last_owner';
// the matching i18n keys live under `household_errors.*`.

import type { TFunction } from 'i18next';

const KNOWN = new Set([
  'last_owner',
  'not_a_member',
  'not_authenticated',
  'not_household_owner',
  'target_not_a_member',
  'cannot_transfer_to_self',
  'invalid_or_expired_invite',
  'invalid_or_expired_follow_code',
  'no_owned_household',
  'cannot_follow_self',
]);

export type HouseholdErrorCode =
  | 'last_owner'
  | 'not_a_member'
  | 'not_authenticated'
  | 'not_household_owner'
  | 'target_not_a_member'
  | 'cannot_transfer_to_self'
  | 'invalid_or_expired_invite'
  | 'invalid_or_expired_follow_code'
  | 'no_owned_household'
  | 'cannot_follow_self'
  | null;

export function householdErrorCode(err: unknown): HouseholdErrorCode {
  const message = extractMessage(err);
  if (!message) return null;
  const code = message.trim();
  return KNOWN.has(code) ? (code as HouseholdErrorCode) : null;
}

export function translateHouseholdError(t: TFunction, err: unknown): string {
  const code = householdErrorCode(err);
  if (code) return t(`household_errors.${code}`);
  return extractMessage(err) ?? '';
}

function extractMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return null;
}
