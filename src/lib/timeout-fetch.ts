// Wraps the platform `fetch` so every Supabase HTTP request is bounded by a
// timeout.
//
// supabase-js passes no timeout to `fetch`, so a request issued on a dead socket
// hangs until the OS-level TCP timeout — often a minute or more. The classic
// trigger is a token refresh or query fired the instant a mobile browser resumes
// the PWA after backgrounding, when the network connection it was using is gone.
// While that request hangs, the Supabase auth lock stays held and every later
// call queues behind it, so the whole app appears frozen until a manual reload.
//
// Bounding the fetch turns that silent hang into an ordinary rejection: React
// Query can retry it, and the on-resume recovery handler can re-fire it on a
// fresh connection (see session-recovery.ts). The auth lock can no longer
// strand the app on its own — we run an in-memory lock that a tab freeze can't
// orphan (see the `lock` option in supabase.ts) — so a request hung on a dead
// socket is the remaining cause of an indefinite freeze, which this bounds.

// Generous enough not to abort a legitimately slow-but-progressing request on a
// poor mobile connection, while far below the OS TCP timeout it replaces.
const DEFAULT_TIMEOUT_MS = 30_000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Supabase Edge Functions are served under `/functions/v1/...` and can run for
// minutes (AI recipe import). They are not on the auth-lock hot path, so leave
// them unbounded and let their own flow surface progress/failure.
function isExempt(url: string): boolean {
  return url.includes('/functions/');
}

function combineSignals(caller: AbortSignal | null, timeout: AbortSignal): AbortSignal {
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

export function createTimeoutFetch(
  baseFetch: typeof fetch = (input, init) => globalThis.fetch(input, init),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    if (isExempt(urlOf(input))) return baseFetch(input, init);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = combineSignals(callerSignal, AbortSignal.timeout(timeoutMs));
    return baseFetch(input, { ...init, signal });
  };
}
