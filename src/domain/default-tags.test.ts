import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSEHOLD_TAGS,
  DEFAULT_PRIMARY_TAGS,
  MAX_HOME_CATEGORIES,
  TAG_PATTERN,
  normalizeTag,
} from './default-tags';

describe('default tags — meal-category vocabulary', () => {
  it('seeds the meal-category library as the allowed tags', () => {
    // The Home category tiles + Customize library are driven by allowed_tags,
    // so the curated default library must carry the meal categories the design
    // ships with (and must NOT carry the retired protein/structure tags).
    for (const tag of [
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'dessert',
      'soup',
      'salad',
      'vegetarian',
      'vegan',
      'meat',
      'fish',
      'quick',
      'drinks',
      'baby',
    ]) {
      expect(DEFAULT_HOUSEHOLD_TAGS).toContain(tag);
    }
    for (const retired of ['main', 'side', 'chicken', 'beef', 'pork', 'drink']) {
      expect(DEFAULT_HOUSEHOLD_TAGS).not.toContain(retired);
    }
  });

  it('leads Home with Breakfast · Lunch · Dinner · Dessert', () => {
    expect([...DEFAULT_PRIMARY_TAGS]).toEqual(['breakfast', 'lunch', 'dinner', 'dessert']);
  });

  it('keeps every primary tag inside the allowed library', () => {
    for (const tag of DEFAULT_PRIMARY_TAGS) {
      expect(DEFAULT_HOUSEHOLD_TAGS).toContain(tag);
    }
  });

  it('keeps the default Home set within the cap (incl. the implicit "All")', () => {
    // "All" is an always-present, non-stored tile, so the stored primary tags
    // may fill at most MAX_HOME_CATEGORIES - 1 slots.
    expect(DEFAULT_PRIMARY_TAGS.length).toBeLessThanOrEqual(MAX_HOME_CATEGORIES - 1);
  });

  it('only ships tags that satisfy the storage shape constraint', () => {
    for (const tag of DEFAULT_HOUSEHOLD_TAGS) {
      expect(TAG_PATTERN.test(tag)).toBe(true);
      expect(normalizeTag(tag)).toBe(tag);
    }
  });

  it('contains no duplicate tags', () => {
    expect(new Set(DEFAULT_HOUSEHOLD_TAGS).size).toBe(DEFAULT_HOUSEHOLD_TAGS.length);
    expect(new Set(DEFAULT_PRIMARY_TAGS).size).toBe(DEFAULT_PRIMARY_TAGS.length);
  });
});
