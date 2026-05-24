// runWithBackgroundDetach: race an import worker against a first-response
// timer. If the worker finishes first, return its value synchronously
// (existing happy path — caller responds 200 with the draft). If the timer
// fires first, hand the in-flight promise to EdgeRuntime.waitUntil so the
// runtime keeps the worker alive after the HTTP response is sent; caller
// responds 202.
//
// The worker promise is the authoritative writer of the import_jobs row
// regardless of which branch wins, so the SPA's Realtime subscription
// observes the same lifecycle either way.

// Supabase Edge Runtime exposes `EdgeRuntime.waitUntil(promise)` for
// post-response background work. The global is provided by the runtime in
// production; in deno test the type-only declaration below keeps the
// compiler happy, and the runtime call path is exercised by the unit test.
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

export type DetachResult<T> =
  | { mode: 'sync'; value: T }
  | { mode: 'background' };

export type DetachOptions<T> = {
  // Total wall-clock budget for the worker. Used by the worker itself for
  // its inner abort signal; the detach helper doesn't enforce it.
  totalMs: number;
  // After this many ms, if the worker hasn't finished, the caller responds
  // 202 and the worker keeps running via EdgeRuntime.waitUntil.
  firstResponseMs: number;
  // The worker. Must always finish by writing terminal state to import_jobs
  // — the caller has no way to surface a thrown error after the response is
  // sent.
  run: () => Promise<T>;
  // Optional hook invoked when the detach decision is made (sync win or
  // background). Useful for adding breadcrumbs in production.
  onDecision?: (mode: 'sync' | 'background') => void;
};

export async function runWithBackgroundDetach<T>(
  opts: DetachOptions<T>,
): Promise<DetachResult<T>> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<'timer'>((resolve) => {
    timerId = setTimeout(() => resolve('timer'), opts.firstResponseMs);
  });

  const workerPromise = opts.run();
  // Tag the worker promise so we can identify it on the race winner.
  const wrappedWorker = workerPromise.then((value) => ({ kind: 'worker' as const, value }));

  const winner = await Promise.race([
    wrappedWorker,
    timer.then((kind) => ({ kind })),
  ]);

  if (winner.kind === 'worker') {
    if (timerId !== null) clearTimeout(timerId);
    opts.onDecision?.('sync');
    return { mode: 'sync', value: winner.value };
  }

  // Timer fired first. Hand the still-running worker promise to the runtime
  // so the function isn't killed when we send the 202 response. Swallow any
  // thrown errors — the worker is responsible for writing terminal state to
  // the import_jobs row, and there's no client to surface a rejection to.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(workerPromise.catch(() => undefined));
  } else {
    // In test environments (or older runtimes) waitUntil isn't available.
    // Don't drop the promise on the floor — keep a reference so the test
    // harness can await completion if it wants. The worker still runs to
    // completion in-process; the caller just won't receive a synchronous
    // ack.
    void workerPromise.catch(() => undefined);
  }
  opts.onDecision?.('background');
  return { mode: 'background' };
}
