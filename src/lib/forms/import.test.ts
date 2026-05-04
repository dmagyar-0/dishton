import { describe, expect, it } from 'vitest';
import { ImportPhotoSchema, ImportUrlSchema, detectImportSource } from './import';

describe('ImportUrlSchema', () => {
  it('accepts a valid URL', () => {
    expect(() => ImportUrlSchema.parse({ url: 'https://example.com/recipe' })).not.toThrow();
  });
  it('rejects non-URLs', () => {
    expect(() => ImportUrlSchema.parse({ url: 'not-a-url' })).toThrow();
  });
});

describe('detectImportSource', () => {
  it('detects instagram.com', () => {
    expect(detectImportSource('https://instagram.com/p/abc')).toBe('instagram');
  });
  it('detects www.instagram.com', () => {
    expect(detectImportSource('https://www.instagram.com/reel/xyz')).toBe('instagram');
  });
  it('detects m.instagram.com', () => {
    expect(detectImportSource('https://m.instagram.com/p/abc')).toBe('instagram');
  });
  it('treats generic blogs as url', () => {
    expect(detectImportSource('https://example.com/recipe')).toBe('url');
  });
  it('does not match instagram.com inside a path', () => {
    expect(detectImportSource('https://example.com/share/instagram.com/p/abc')).toBe('url');
  });
  it('does not match a lookalike host', () => {
    expect(detectImportSource('https://notinstagram.com/p/abc')).toBe('url');
  });
  it('returns url for malformed input', () => {
    expect(detectImportSource('not-a-url')).toBe('url');
  });
});

describe('ImportPhotoSchema', () => {
  it('accepts an empty object (comment is optional)', () => {
    expect(() => ImportPhotoSchema.parse({})).not.toThrow();
  });
  it('accepts a literal empty string', () => {
    expect(() => ImportPhotoSchema.parse({ comment: '' })).not.toThrow();
  });
  it('accepts a short comment', () => {
    expect(() => ImportPhotoSchema.parse({ comment: 'hint' })).not.toThrow();
  });
  it('rejects a comment over 500 chars', () => {
    expect(() => ImportPhotoSchema.parse({ comment: 'x'.repeat(501) })).toThrow();
  });
});
