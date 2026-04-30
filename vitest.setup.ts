import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    class MockIO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
    ).IntersectionObserver = MockIO as unknown as typeof IntersectionObserver;
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class MockRO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockRO as unknown as typeof ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = (): boolean => false;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = (): void => undefined;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = (): void => undefined;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (): void => undefined;
  }
}
