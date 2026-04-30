import { describe, expect, it } from 'vitest';
import { languageFallbackChain, normaliseBcp47 } from './language';

describe('normaliseBcp47', () => {
  it('lowercases language and uppercases region', () => {
    expect(normaliseBcp47('FR-ca')).toBe('fr-CA');
    expect(normaliseBcp47('en')).toBe('en');
    expect(normaliseBcp47('en_us')).toBe('en-US');
  });
  it('returns null for malformed input', () => {
    expect(normaliseBcp47('english')).toBeNull();
    expect(normaliseBcp47('')).toBeNull();
    expect(normaliseBcp47(null)).toBeNull();
    expect(normaliseBcp47(undefined)).toBeNull();
  });
});

describe('languageFallbackChain', () => {
  it('falls back from region to base to en', () => {
    expect(languageFallbackChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(languageFallbackChain('pt-BR')).toEqual(['pt-BR', 'pt', 'en']);
  });
  it('returns just the language for base codes', () => {
    expect(languageFallbackChain('en')).toEqual(['en']);
    expect(languageFallbackChain('de')).toEqual(['de', 'en']);
  });
  it('falls back to en for malformed input', () => {
    expect(languageFallbackChain('zonk')).toEqual(['en']);
  });
});
