import { describe, expect, it } from 'vitest';
import { LoginSchema, ResetSchema, SignupSchema, UpdatePasswordSchema } from './auth';

describe('LoginSchema', () => {
  it('accepts a well-formed login', () => {
    expect(() =>
      LoginSchema.parse({ email: 'a@b.test', password: 'longenoughpassword' }),
    ).not.toThrow();
  });
  it('rejects short passwords', () => {
    expect(() => LoginSchema.parse({ email: 'a@b.test', password: 'short' })).toThrow();
  });
  it('rejects bad emails', () => {
    expect(() => LoginSchema.parse({ email: 'not-an-email', password: 'longenoughpw' })).toThrow();
  });
});

describe('SignupSchema', () => {
  it('requires display_name', () => {
    expect(() =>
      SignupSchema.parse({ email: 'a@b.test', password: 'longenoughpw', display_name: 'A' }),
    ).not.toThrow();
    expect(() =>
      SignupSchema.parse({ email: 'a@b.test', password: 'longenoughpw', display_name: '' }),
    ).toThrow();
  });
});

describe('ResetSchema', () => {
  it('accepts a valid email', () => {
    expect(() => ResetSchema.parse({ email: 'a@b.test' })).not.toThrow();
  });
});

describe('UpdatePasswordSchema', () => {
  it('accepts matching passwords of at least 10 chars', () => {
    expect(() =>
      UpdatePasswordSchema.parse({ password: 'longenoughpw', confirm: 'longenoughpw' }),
    ).not.toThrow();
  });
  it('rejects short passwords', () => {
    expect(() => UpdatePasswordSchema.parse({ password: 'short', confirm: 'short' })).toThrow();
  });
  it('rejects mismatched passwords', () => {
    expect(() =>
      UpdatePasswordSchema.parse({ password: 'longenoughpw', confirm: 'differentlongpw' }),
    ).toThrow();
  });
});
