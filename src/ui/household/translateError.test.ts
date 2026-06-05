import { describe, expect, it, vi } from 'vitest';

const logBreadcrumb = vi.fn();
vi.mock('@/observability/sentry', () => ({
  logErrorBreadcrumb: (...args: unknown[]) => logBreadcrumb(...args),
}));

import type { TFunction } from 'i18next';
import { householdErrorCode, translateHouseholdError } from './translateError';

// Minimal stub: echoes the key so we can assert which translation was chosen.
const t = ((key: string) => key) as unknown as TFunction;

describe('householdErrorCode', () => {
  it('recognizes mapped Postgres codes including the new delete-guard codes', () => {
    expect(householdErrorCode({ message: 'last_owner' })).toBe('last_owner');
    expect(householdErrorCode({ message: 'cannot_delete_personal_household' })).toBe(
      'cannot_delete_personal_household',
    );
    expect(householdErrorCode({ message: 'household_not_found' })).toBe('household_not_found');
  });

  it('returns null for unmapped messages', () => {
    expect(householdErrorCode({ message: 'duplicate key value violates unique constraint' })).toBe(
      null,
    );
  });
});

describe('translateHouseholdError', () => {
  it('maps known codes to their household_errors.* key', () => {
    expect(translateHouseholdError(t, { message: 'not_household_owner' })).toBe(
      'household_errors.not_household_owner',
    );
    expect(translateHouseholdError(t, { message: 'cannot_delete_personal_household' })).toBe(
      'household_errors.cannot_delete_personal_household',
    );
  });

  it('falls back to a generic key and breadcrumbs the raw string for unmapped errors', () => {
    logBreadcrumb.mockClear();
    const raw = 'relation "app.households" does not exist';
    expect(translateHouseholdError(t, { message: raw })).toBe('household_errors.generic');
    // The raw internal string is logged, never returned to the caller.
    expect(logBreadcrumb).toHaveBeenCalledWith('unmapped household error', { raw });
  });
});
