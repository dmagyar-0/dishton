// Wraps supabase.functions.invoke() so every Edge Function call is classified
// into exactly one outcome and reported as an `edge_call` analytics event
// (plus a Sentry breadcrumb for anything that isn't `ok`). This is the answer
// to "we sent a request but the Edge Function never responded" -- see
// docs/14-observability.md.
//
// Classification is driven by what @supabase/functions-js actually throws
// (studied from node_modules, not guessed):
//   - FunctionsHttpError  -- `!response.ok`: the function (or the gateway in
//     front of it) returned a non-2xx status. `error.context` is the Response.
//     A 502/503/504 means the gateway answered on the function's behalf
//     because the function itself never did -> `no_response`. Any other
//     non-2xx (ordinarily 4xx) is the function's own answer -> `http_error`.
//   - FunctionsRelayError -- the Supabase relay couldn't reach the function at
//     all (its `x-relay-error` header case) -> `no_response`, same bucket as
//     a 502/503/504: the function never answered.
//   - FunctionsFetchError -- the underlying `fetch()` call itself rejected.
//     This covers BOTH our own timeout firing and a genuine network failure
//     (offline/DNS/TLS) with no way to tell them apart from the error alone,
//     so we track whether *our own* AbortController (armed by `timeoutMs`)
//     is the one that fired -> `timeout` vs `network`.
//
// See src/lib/timeout-fetch.ts for the same caller+timeout AbortSignal
// combining pattern used for the plain-fetch path.

import { supabase } from '@/lib/supabase';
import { track } from '@/observability/analytics';
import { logErrorBreadcrumb } from '@/observability/sentry';

export type InvokeOutcome = 'ok' | 'http_error' | 'no_response' | 'timeout' | 'network';

export type InvokeFunctionOptions = {
  body?: Record<string, unknown> | FormData | Blob | ArrayBuffer | string;
  // Merged with the internal timeout signal (if `timeoutMs` is set) -- whichever
  // fires first wins, same as createTimeoutFetch in timeout-fetch.ts.
  signal?: AbortSignal;
  // Aborts the call after this many ms if no response has arrived yet. Only a
  // timeout raised by THIS controller is ever classified as `timeout`; an
  // externally-supplied `signal` firing (e.g. an unmounted component) falls
  // through to `network` since we can't attribute it to "we gave up waiting".
  timeoutMs?: number;
};

export type InvokeFunctionResult<T> = {
  data: T | null;
  error: unknown | null;
  outcome: InvokeOutcome;
  status: number | null;
  ms: number;
};

// Gateway/boot failures: the edge runtime (or the relay fronting it) answered
// on the function's behalf because the function itself never did -- cold
// start timeout, crash on boot, region outage.
const GATEWAY_STATUSES = new Set([502, 503, 504]);

function combineSignals(caller: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([caller, timeout]);
  // Fallback for engines without AbortSignal.any: forward whichever fires first.
  const controller = new AbortController();
  const forward = (from: AbortSignal) => {
    if (from.aborted) controller.abort(from.reason);
    else from.addEventListener('abort', () => controller.abort(from.reason), { once: true });
  };
  forward(caller);
  forward(timeout);
  return controller.signal;
}

function statusFromErrorContext(context: unknown): number | null {
  if (context instanceof Response) return context.status;
  return null;
}

function classifyError(
  error: unknown,
  timedOut: boolean,
): { outcome: InvokeOutcome; status: number | null } {
  const name = (error as { name?: string } | null)?.name ?? '';
  const context = (error as { context?: unknown } | null)?.context;

  if (name === 'FunctionsHttpError') {
    const status = statusFromErrorContext(context);
    if (status !== null && GATEWAY_STATUSES.has(status)) {
      return { outcome: 'no_response', status };
    }
    return { outcome: 'http_error', status };
  }

  if (name === 'FunctionsRelayError') {
    return { outcome: 'no_response', status: statusFromErrorContext(context) };
  }

  if (name === 'FunctionsFetchError') {
    return { outcome: timedOut ? 'timeout' : 'network', status: null };
  }

  // Unrecognised error shape (a future supabase-js version, or a test double).
  // Classify conservatively rather than throwing out of a telemetry wrapper.
  return { outcome: 'network', status: null };
}

export async function invokeFunction<T = unknown>(
  fn: string,
  options: InvokeFunctionOptions = {},
): Promise<InvokeFunctionResult<T>> {
  const { body, signal: callerSignal, timeoutMs } = options;

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let signal = callerSignal;
  if (timeoutMs !== undefined) {
    const timeoutController = new AbortController();
    timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    signal = combineSignals(callerSignal, timeoutController.signal);
  }

  const t0 = performance.now();
  let data: T | null = null;
  let error: unknown = null;
  let okStatus: number | null = null;
  try {
    const raw = await supabase.functions.invoke(fn, { body, signal });
    data = (raw.data as T | null) ?? null;
    error = raw.error ?? null;
    okStatus = raw.response?.status ?? null;
  } catch (e) {
    // FunctionsClient.invoke() catches internally and resolves rather than
    // rejects (verified against the installed @supabase/functions-js), but
    // guard against a future version -- or a test double -- that throws.
    error = e;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  const ms = Math.round(performance.now() - t0);

  const { outcome, status } = error
    ? classifyError(error, timedOut)
    : { outcome: 'ok' as const, status: okStatus };

  // Telemetry must never fail or slow down the call it's describing: track()
  // is itself a no-op-safe fire-and-forget, and the breadcrumb call below
  // cannot throw (Sentry.addBreadcrumb never throws for a bad DSN).
  track('edge_call', { fn, outcome, status, ms });
  if (outcome !== 'ok') {
    logErrorBreadcrumb('edge_call', { fn, outcome, status, ms });
  }

  return { data, error, outcome, status, ms };
}
