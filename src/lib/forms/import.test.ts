import { describe, expect, it } from 'vitest';
import { ImportInstagramSchema, ImportPhotoSchema, ImportUrlSchema } from './import';

describe('ImportUrlSchema', () => {
  it('accepts a valid URL', () => {
    expect(() => ImportUrlSchema.parse({ url: 'https://example.com/recipe' })).not.toThrow();
  });
  it('rejects non-URLs', () => {
    expect(() => ImportUrlSchema.parse({ url: 'not-a-url' })).toThrow();
  });
});

describe('ImportInstagramSchema', () => {
  it('accepts an instagram URL', () => {
    expect(() => ImportInstagramSchema.parse({ url: 'https://instagram.com/p/123' })).not.toThrow();
  });
  it('rejects a non-instagram URL', () => {
    expect(() => ImportInstagramSchema.parse({ url: 'https://example.com/x' })).toThrow();
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
