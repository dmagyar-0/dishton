import { describe, expect, it } from 'vitest';
import { sanitizeNextPath } from './safe-redirect';

describe('sanitizeNextPath', () => {
  it('accepts a same-origin path', () => {
    expect(sanitizeNextPath('/f/f_ABCDEFGHIJKL')).toBe('/f/f_ABCDEFGHIJKL');
  });

  it('accepts a path with a query string', () => {
    expect(sanitizeNextPath('/households?tab=sharing')).toBe('/households?tab=sharing');
  });

  it('accepts root', () => {
    expect(sanitizeNextPath('/')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNextPath('//evil.com')).toBe('/');
  });

  it('rejects a backslash trick some browsers treat as a scheme separator', () => {
    expect(sanitizeNextPath('/\\evil.com')).toBe('/');
  });

  it('rejects an absolute URL', () => {
    expect(sanitizeNextPath('https://evil.com')).toBe('/');
    expect(sanitizeNextPath('http://evil.com/x')).toBe('/');
  });

  it('rejects a path missing the leading slash', () => {
    expect(sanitizeNextPath('f/code')).toBe('/');
  });

  it('falls back to / for null, undefined, and empty input', () => {
    expect(sanitizeNextPath(null)).toBe('/');
    expect(sanitizeNextPath(undefined)).toBe('/');
    expect(sanitizeNextPath('')).toBe('/');
  });
});
