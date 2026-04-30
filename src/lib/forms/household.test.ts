import { describe, expect, it } from 'vitest';
import { AddFollowSchema, CreateHouseholdSchema, RedeemInviteSchema } from './household';

describe('CreateHouseholdSchema', () => {
  it('accepts 1-80 char names', () => {
    expect(() => CreateHouseholdSchema.parse({ name: 'X' })).not.toThrow();
    expect(() => CreateHouseholdSchema.parse({ name: 'A'.repeat(80) })).not.toThrow();
  });
  it('rejects empty and over-length', () => {
    expect(() => CreateHouseholdSchema.parse({ name: '' })).toThrow();
    expect(() => CreateHouseholdSchema.parse({ name: 'A'.repeat(81) })).toThrow();
  });
});

describe('RedeemInviteSchema', () => {
  it('accepts 8-char base32 codes', () => {
    expect(() => RedeemInviteSchema.parse({ code: 'ABCDE234' })).not.toThrow();
  });
  it('rejects lowercase, wrong length, or non-base32 chars', () => {
    expect(() => RedeemInviteSchema.parse({ code: 'abcde234' })).toThrow();
    expect(() => RedeemInviteSchema.parse({ code: 'ABCDE23' })).toThrow();
    expect(() => RedeemInviteSchema.parse({ code: 'ABCDE018' })).toThrow();
  });
});

describe('AddFollowSchema', () => {
  it('accepts f_<base32-12>', () => {
    expect(() => AddFollowSchema.parse({ code: 'f_ABCDE234FGHJ' })).not.toThrow();
  });
  it('rejects without prefix or wrong length', () => {
    expect(() => AddFollowSchema.parse({ code: 'ABCDE234FGHJ' })).toThrow();
    expect(() => AddFollowSchema.parse({ code: 'f_ABCDE234FGH' })).toThrow();
  });
});
