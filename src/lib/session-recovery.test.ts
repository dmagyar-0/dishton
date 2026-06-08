// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth: { getSession } } }));

import { installSessionRecovery } from './session-recovery';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installSessionRecovery', () => {
  let now: number;
  let invalidateQueries: ReturnType<typeof vi.fn>;
  let cleanup: () => void;

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    getSession.mockReset().mockResolvedValue({ data: { session: null } });
    invalidateQueries = vi.fn().mockResolvedValue(undefined);
    cleanup = installSessionRecovery({ invalidateQueries } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('refetches active queries after a long background, nudging the session', async () => {
    setVisibility('hidden');
    now += 11_000;
    setVisibility('visible');

    expect(getSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ refetchType: 'active' });
    });
  });

  it('does nothing after only a brief tab blur', () => {
    setVisibility('hidden');
    now += 2_000;
    setVisibility('visible');

    expect(getSession).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('recovers when the network comes back online', () => {
    window.dispatchEvent(new Event('online'));
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('debounces a burst of resume events into a single recovery', () => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('stops responding after cleanup', () => {
    cleanup();
    window.dispatchEvent(new Event('online'));
    expect(getSession).not.toHaveBeenCalled();
  });
});
