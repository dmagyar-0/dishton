import { describe, expect, it } from 'vitest';
import { pickCanonicalHousehold } from './canonical-household';

const owner = (household_id: string, is_personal: boolean) => ({
  household_id,
  role: 'owner' as const,
  is_personal,
});

describe('pickCanonicalHousehold', () => {
  it('prefers the personal household when one exists', () => {
    const memberships = [owner('shared-1', false), owner('personal-1', true)];
    expect(pickCanonicalHousehold(memberships)?.household_id).toBe('personal-1');
  });

  it('falls back to the first membership when none is personal', () => {
    const memberships = [owner('shared-1', false), owner('shared-2', false)];
    expect(pickCanonicalHousehold(memberships)?.household_id).toBe('shared-1');
  });

  it('returns undefined for an empty membership list', () => {
    expect(pickCanonicalHousehold([])).toBeUndefined();
  });
});
