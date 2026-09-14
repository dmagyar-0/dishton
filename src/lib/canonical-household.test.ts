import { describe, expect, it } from 'vitest';
import { pickCanonicalHousehold, resolveManagedHousehold } from './canonical-household';

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

describe('resolveManagedHousehold', () => {
  const memberships = [owner('shared-1', false), owner('personal-1', true)];

  it('defaults to the canonical household when nothing is picked', () => {
    expect(resolveManagedHousehold(memberships)).toBe('personal-1');
  });

  it('honours an explicit pick — the shared household a follow may live on', () => {
    expect(resolveManagedHousehold(memberships, 'shared-1')).toBe('shared-1');
  });

  it('falls back when the pick is no longer a membership', () => {
    expect(resolveManagedHousehold(memberships, 'left-this-one')).toBe('personal-1');
  });

  it('returns an empty string when there are no memberships to scope to', () => {
    expect(resolveManagedHousehold([], 'anything')).toBe('');
  });
});
