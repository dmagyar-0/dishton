// runDetached: run an import worker entirely in the background. The worker
// starts immediately, its terminal write is scheduled via
// EdgeRuntime.waitUntil so the Supabase runtime keeps it alive after the HTTP
// response is sent, and runDetached returns at once so the caller can respond
// 202. The worker must not write terminal state itself — onFinish does that
// ('awaiting_save' on success, 'needs_review'/'failed' otherwise) and onError
// handles a thrown worker. Neither callback may throw; wrap your own try/catch.

// Supabase Edge Runtime exposes `EdgeRuntime.waitUntil(promise)` for
// post-response background work. The global is provided by the runtime in
// production; declared here so the deno type checker is happy in tests.
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

export type DetachHandlers<T> = {
  // The worker. Pure: do the work, return a result value. Don't write terminal
  // state to import_jobs — onFinish handles that.
  work: () => Promise<T>;
  // Called with the worker's return value. Writes terminal state to
  // import_jobs ('awaiting_save' on success, 'needs_review'/'failed'
  // otherwise). Must not throw; wrap your own try/catch.
  onFinish: (value: T) => Promise<void>;
  // Called when the worker throws. Writes 'failed' state. Must not throw.
  onError: (err: unknown) => Promise<void>;
};

export function runDetached<T>(opts: DetachHandlers<T>): void {
  const tail = opts.work().then(
    (value) => opts.onFinish(value).catch(() => undefined),
    (err) => opts.onError(err).catch(() => undefined),
  );

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(tail);
  } else {
    // Test environments lack waitUntil; keep a reference so an unhandled
    // rejection doesn't terminate the process.
    void tail;
  }
}
