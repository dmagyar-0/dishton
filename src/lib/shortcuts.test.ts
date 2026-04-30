import { describe, expect, it } from 'vitest';
import { isTypingIntoInput, shortcuts } from './shortcuts';

describe('shortcuts', () => {
  it('lists every required shortcut', () => {
    const keys = shortcuts.map((s) => s.keys.join(','));
    for (const k of ['s', 'i', 'j', 'k', '+', '-', '[', ']', '?', 'Esc']) {
      expect(keys.some((entry) => entry.includes(k))).toBe(true);
    }
  });

  it('every shortcut has a description and a scope', () => {
    for (const s of shortcuts) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(['list', 'detail', 'global']).toContain(s.scope);
    }
  });
});

describe('isTypingIntoInput', () => {
  function eventOnTag(tag: string): Event {
    const e = new Event('keydown');
    Object.defineProperty(e, 'target', {
      value: { tagName: tag.toUpperCase(), isContentEditable: false } as unknown as EventTarget,
    });
    return e;
  }

  it('returns true for inputs and textareas', () => {
    expect(isTypingIntoInput(eventOnTag('input'))).toBe(true);
    expect(isTypingIntoInput(eventOnTag('textarea'))).toBe(true);
  });

  it('returns false for divs', () => {
    expect(isTypingIntoInput(eventOnTag('div'))).toBe(false);
  });

  it('returns false when target is null', () => {
    const e = new Event('keydown');
    Object.defineProperty(e, 'target', { value: null });
    expect(isTypingIntoInput(e)).toBe(false);
  });
});
