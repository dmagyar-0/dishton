import { describe, expect, it } from 'vitest';
import { ImportInstagramSchema, ImportUrlSchema } from './import';

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
