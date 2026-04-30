import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { Recipe } from './recipe';

/**
 * Stable JSON stringify: sorts object keys recursively so semantically equal
 * inputs produce identical output. Arrays preserve their order (positions are
 * meaningful in the Recipe shape).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function buildTranslationCacheKey(
  recipe: Recipe,
  targetLanguage: string,
): { sourceHash: string; key: string } {
  const canonicalJson = stableStringify(recipe);
  const hashBytes = sha256(new TextEncoder().encode(canonicalJson));
  const sourceHash = bytesToHex(hashBytes);
  return { sourceHash, key: `${sourceHash}:${targetLanguage}` };
}
