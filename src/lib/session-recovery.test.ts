// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, isConnected, connect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  isConnected: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession }, realtime: { isConnected, connect } },
}));

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('../observability/sentry', () => ({
  captureException,
  logErrorBreadcrumb: vi.fn(),
}));

import { installSessionRecovery } from './session-recovery';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

// Let the resolved getSession()/.finally() microtask chain run to completion.
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('installSessionRecovery', () => {
  let now: number;
  let invalidateQueries: ReturnType<typeof vi.fn>;
  let cleanup: () => void;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    getSession.mockReset().mockResolvedValue({ data: { session: null } });
    isConnected.mockReset().mockReturnValue(true);
    connect.mockReset();
    captureException.mockReset();
    invalidateQueries = vi.fn().mockResolvedValue(undefined);
    reload = vi.fn();
    // jsdom's window.location.reload is non-configurable, so stub the whole
    // location object for the duration of each test.
    vi.stubGlobal('location', { href: 'http://localhost/', origin: 'http://localhost', reload });
    setOnline(true);
    sessionStorage.clear();
    cleanup = installSessionRecovery({ invalidateQueries } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refetches active queries after a long background, nudging the session', async () => {
    setVisibility('hidden');
    now += 11_000;
    setVisibility('visible');

    expect(getSession).toHaveBeenCalledTimes(1);
    await flush();
    expect(invalidateQueries).toHaveBeenCalledWith({ refetchType: 'active' });
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

  it('recovers on the Page Lifecycle resume event, bypassing the hidden gate', () => {
    // No preceding `hidden`/`freeze` — `resume` alone is a definitive freeze
    // signal and must recover regardless of how long we were away.
    document.dispatchEvent(new Event('resume'));
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('reconnects a dropped Realtime socket on resume so channels rejoin', () => {
    // The socket's heartbeat is throttled while the tab is backgrounded and the
    // server drops it silently; on resume it reports disconnected.
    isConnected.mockReturnValue(false);
    document.dispatchEvent(new Event('resume'));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect Realtime when the socket is still connected', () => {
    isConnected.mockReturnValue(true);
    document.dispatchEvent(new Event('resume'));
    expect(connect).not.toHaveBeenCalled();
  });

  it('treats a freeze as the start of a background and recovers on resume', () => {
    document.dispatchEvent(new Event('freeze'));
    now += 11_000;
    document.dispatchEvent(new Event('resume'));
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

  it('reloads as a last resort when session validation never settles', async () => {
    getSession.mockReturnValue(new Promise(() => {})); // wedged: never resolves
    window.dispatchEvent(new Event('online'));

    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).toHaveBeenCalledTimes(1);
    // The wedge is otherwise silent; we must report it so it's no longer
    // invisible in production.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not reload when validation settles before the watchdog fires', async () => {
    window.dispatchEvent(new Event('online'));
    await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while offline', async () => {
    setOnline(false);
    getSession.mockReturnValue(new Promise(() => {}));
    window.dispatchEvent(new Event('online'));

    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not loop: a second wedge within the guard window does not reload again', async () => {
    getSession.mockReturnValue(new Promise(() => {}));

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).toHaveBeenCalledTimes(1);

    now += 30_000; // still inside the 60s guard window
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
