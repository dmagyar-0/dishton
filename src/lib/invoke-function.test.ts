import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, trackMock, logErrorBreadcrumbMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  trackMock: vi.fn(),
  logErrorBreadcrumbMock: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));
vi.mock('@/observability/analytics', () => ({ track: trackMock }));
vi.mock('@/observability/sentry', () => ({ logErrorBreadcrumb: logErrorBreadcrumbMock }));

import { invokeFunction } from './invoke-function';

// Mirrors what @supabase/functions-js actually throws (see FunctionsClient.js):
// FunctionsHttpError/FunctionsRelayError carry the raw Response as `.context`;
// FunctionsFetchError carries the underlying fetch rejection.
function httpError(status: number): { name: string; context: Response } {
  return { name: 'FunctionsHttpError', context: new Response(null, { status }) };
}
function relayError(): { name: string; context: Response } {
  return {
    name: 'FunctionsRelayError',
    context: new Response(null, { status: 200, headers: { 'x-relay-error': 'true' } }),
  };
}
function fetchError(): { name: string; context: unknown } {
  return { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') };
}

describe('invokeFunction', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    trackMock.mockReset();
    logErrorBreadcrumbMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ok: resolves with no error', async () => {
    invokeMock.mockResolvedValue({
      data: { job_id: 'j1' },
      error: null,
      response: new Response(null, { status: 202 }),
    });

    const result = await invokeFunction<{ job_id: string }>('import-url', { body: { url: 'x' } });

    expect(result.outcome).toBe('ok');
    expect(result.status).toBe(202);
    expect(result.data).toEqual({ job_id: 'j1' });
    expect(result.error).toBeNull();
    expect(typeof result.ms).toBe('number');
    expect(invokeMock).toHaveBeenCalledWith('import-url', {
      body: { url: 'x' },
      signal: undefined,
    });
    expect(trackMock).toHaveBeenCalledWith('edge_call', {
      fn: 'import-url',
      outcome: 'ok',
      status: 202,
      ms: expect.any(Number),
    });
    // Only non-ok outcomes get a Sentry breadcrumb.
    expect(logErrorBreadcrumbMock).not.toHaveBeenCalled();
  });

  it('http_error: the function itself returned a 4xx', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(400) });

    const result = await invokeFunction('translate-recipe');

    expect(result.outcome).toBe('http_error');
    expect(result.status).toBe(400);
    expect(trackMock).toHaveBeenCalledWith('edge_call', {
      fn: 'translate-recipe',
      outcome: 'http_error',
      status: 400,
      ms: expect.any(Number),
    });
    expect(logErrorBreadcrumbMock).toHaveBeenCalledWith('edge_call', {
      fn: 'translate-recipe',
      outcome: 'http_error',
      status: 400,
      ms: expect.any(Number),
    });
  });

  it('no_response: a 502/503/504 means the gateway answered, not the function', async () => {
    for (const status of [502, 503, 504]) {
      invokeMock.mockResolvedValue({ data: null, error: httpError(status) });
      const result = await invokeFunction('import-photo');
      expect(result.outcome).toBe('no_response');
      expect(result.status).toBe(status);
    }
  });

  it('no_response: a relay error means the function never answered', async () => {
    invokeMock.mockResolvedValue({ data: null, error: relayError() });

    const result = await invokeFunction('recipe-chat-send');

    expect(result.outcome).toBe('no_response');
    expect(logErrorBreadcrumbMock).toHaveBeenCalledWith(
      'edge_call',
      expect.objectContaining({ fn: 'recipe-chat-send', outcome: 'no_response' }),
    );
  });

  it('network: a fetch failure with no timeout in play is a network error, not a timeout', async () => {
    invokeMock.mockResolvedValue({ data: null, error: fetchError() });

    const result = await invokeFunction('import-url');

    expect(result.outcome).toBe('network');
    expect(result.status).toBeNull();
  });

  it('timeout: our own AbortSignal firing before any response is a timeout, not a network error', async () => {
    vi.useFakeTimers();
    // Model the real invoke() contract: it resolves (never rejects) once the
    // combined signal aborts, wrapping the abort in a FunctionsFetchError --
    // exactly like a genuine network failure would look from the outside.
    invokeMock.mockImplementation(
      (_fn: string, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => {
            resolve({ data: null, error: fetchError() });
          });
        }),
    );

    const pending = invokeFunction('import-url', { timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.outcome).toBe('timeout');
    expect(trackMock).toHaveBeenCalledWith(
      'edge_call',
      expect.objectContaining({ fn: 'import-url', outcome: 'timeout' }),
    );
  });

  it('a caller-supplied signal aborting (not our own timeout) still falls through to network', async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation(
      (_fn: string, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => {
            resolve({ data: null, error: fetchError() });
          });
        }),
    );

    const pending = invokeFunction('import-url', { signal: controller.signal });
    controller.abort();
    const result = await pending;

    expect(result.outcome).toBe('network');
  });

  it('never throws even if supabase.functions.invoke rejects directly', async () => {
    invokeMock.mockRejectedValue(new Error('unexpected'));

    const result = await invokeFunction('import-url');

    expect(result.outcome).toBe('network');
    expect(result.data).toBeNull();
  });

  it('does not apply a timeout when timeoutMs is omitted', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null, response: null });

    await invokeFunction('translate-recipe', { body: { recipe_id: 'r1' } });

    const call = invokeMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(call.signal).toBeUndefined();
  });
});
