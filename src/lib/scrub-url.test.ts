import { describe, expect, it } from 'vitest';
import { scrubUrl } from './scrub-url';

describe('scrubUrl', () => {
  it('drops URL fragments entirely', () => {
    expect(scrubUrl('https://app.test/auth/callback#access_token=eyJx&type=recovery')).toBe(
      'https://app.test/auth/callback',
    );
  });

  it('redacts PKCE exchange codes', () => {
    expect(scrubUrl('https://app.test/auth/update-password?code=abc123&foo=1')).toBe(
      'https://app.test/auth/update-password?code=[redacted]&foo=1',
    );
  });

  it('redacts token-ish params wherever they appear', () => {
    expect(scrubUrl('https://app.test/x?foo=1&refresh_token=secret')).toBe(
      'https://app.test/x?foo=1&refresh_token=[redacted]',
    );
    expect(scrubUrl('https://app.test/x?access_token=secret')).toBe(
      'https://app.test/x?access_token=[redacted]',
    );
  });

  it('leaves clean URLs untouched', () => {
    expect(scrubUrl('https://app.test/h/abc/r/def')).toBe('https://app.test/h/abc/r/def');
  });
});
