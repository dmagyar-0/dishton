// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

let mockSession: { user: { id: string } } | null = { user: { id: 'user-1' } };
vi.mock('@/lib/auth', () => ({
  useAuth: { getState: () => ({ session: mockSession }) },
}));

describe('analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    insertMock.mockReset().mockResolvedValue({ data: null, error: null });
    fromMock.mockClear();
    mockSession = { user: { id: 'user-1' } };
    sessionStorage.clear();
    vi.stubEnv('VITE_FEATURE_ANALYTICS', 'true');
    vi.stubEnv('VITE_RELEASE_SHA', 'sha-test');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('is a complete no-op when the feature flag is off', async () => {
    vi.stubEnv('VITE_FEATURE_ANALYTICS', 'false');
    const { track } = await import('./analytics');
    track('app_open');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('is a complete no-op when signed out', async () => {
    mockSession = null;
    const { track } = await import('./analytics');
    track('app_open');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('flushes a queued event on the 5s timer', async () => {
    const { track } = await import('./analytics');
    track('app_open');
    expect(fromMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fromMock).toHaveBeenCalledWith('analytics_events');
    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertMock.mock.calls[0]?.[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      profile_id: 'user-1',
      event: 'app_open',
      release_sha: 'sha-test',
      display_mode: 'browser',
    });
    expect(typeof rows[0].session_id).toBe('string');
  });

  it('flushes immediately once 16 events are queued, without waiting for the timer', async () => {
    const { track } = await import('./analytics');
    for (let i = 0; i < 16; i++) track('recipe_viewed');
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]?.[0]).toHaveLength(16);
  });

  it('batches multiple events queued within the same window into one insert', async () => {
    const { track } = await import('./analytics');
    track('app_open');
    track('recipe_viewed');
    track('search_performed', { result_count: 3 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('flushes on visibilitychange -> hidden', async () => {
    const { track } = await import('./analytics');
    track('app_open');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('flushes on pagehide', async () => {
    const { track } = await import('./analytics');
    track('app_open');
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('drops the batch silently on insert failure, never throwing or retry-storming', async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { track } = await import('./analytics');
    track('app_open');
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertMock).toHaveBeenCalledTimes(1);
    // The failed batch was dropped, not requeued -- nothing to flush on the
    // next timer tick.
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even when the client rejects outright', async () => {
    insertMock.mockRejectedValue(new Error('network down'));
    const { track } = await import('./analytics');
    expect(() => track('app_open')).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('strips disallowed prop keys, keeping only the scalar allowlist', async () => {
    const { track } = await import('./analytics');
    track('edge_call', {
      fn: 'import-url',
      outcome: 'timeout',
      ms: 1200,
      status: 504,
      recipe_title: 'a disallowed key with recipe content',
      email: 'user@example.com',
    } as unknown as Record<string, string | number>);
    await vi.advanceTimersByTimeAsync(5000);
    const row = insertMock.mock.calls[0]?.[0]?.[0];
    expect(row.props).toEqual({ fn: 'import-url', outcome: 'timeout', ms: 1200, status: 504 });
  });

  it('caps overlong string prop values instead of shipping unbounded text', async () => {
    const { track } = await import('./analytics');
    track('import_failed', { error_code: 'x'.repeat(500) });
    await vi.advanceTimersByTimeAsync(5000);
    const row = insertMock.mock.calls[0]?.[0]?.[0];
    expect((row.props.error_code as string).length).toBeLessThanOrEqual(200);
  });

  it('assigns a stable per-tab session id persisted in sessionStorage', async () => {
    const { track } = await import('./analytics');
    track('app_open');
    await vi.advanceTimersByTimeAsync(5000);
    const first = insertMock.mock.calls[0]?.[0]?.[0].session_id;
    expect(sessionStorage.getItem('dishton.analytics.session_id')).toBe(first);

    track('app_open');
    await vi.advanceTimersByTimeAsync(5000);
    const second = insertMock.mock.calls[1]?.[0]?.[0].session_id;
    expect(second).toBe(first);
  });
});
