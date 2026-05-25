// runWithBackgroundDetach: race an import worker against a first-response
// timer. If the worker finishes first, return its value synchronously
// (existing happy path — caller responds 200 with the draft). If the timer
// fires first, hand the in-flight promise to EdgeRuntime.waitUntil so the
// runtime keeps the worker alive after the HTTP response is sent; caller
// responds 202.
//
// The helper takes the worker as a pure function that returns a result
// value (no terminal writes), then routes the result into `onFinish` with
// the chosen mode. This lets sync-mode imports write `status='done'` and
// background-mode imports write `status='awaiting_save'`, which keeps the
// SPA's Realtime listener idempotent: it only auto-saves on
// `awaiting_save`, so the sync caller's `save_recipe` can never race with
// the listener.

// Supabase Edge Runtime exposes `EdgeRuntime.waitUntil(promise)` for
// post-response background work. The global is provided by the runtime in
// production; declared here so the deno type checker is happy in tests.
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

export type DetachMode = 'sync' | 'background';

export type DetachResult<T> =
  | { mode: 'sync'; value: T }
  | { mode: 'background' };

export type DetachOptions<T> = {
  // After this many ms, if the worker hasn't finished, the caller responds
  // 202 and the worker keeps running via EdgeRuntime.waitUntil.
  firstResponseMs: number;
  // The worker. Pure: do the work, return a result value. Don't write
  // terminal state to import_jobs — onFinish handles that based on mode.
  work: () => Promise<T>;
  // Called after the race decides, with the worker's return value. Writes
  // terminal state to import_jobs ('done' in sync mode, 'awaiting_save' in
  // background mode). Must not throw; wrap your own try/catch.
  onFinish: (value: T, mode: DetachMode) => Promise<void>;
  // Called when the worker throws. Writes 'failed' state. Must not throw.
  onError: (err: unknown) => Promise<void>;
  // Optional hook invoked when the detach decision is made. Useful for
  // adding breadcrumbs in production.
  onDecision?: (mode: DetachMode) => void;
};

export async function runWithBackgroundDetach<T>(
  opts: DetachOptions<T>,
): Promise<DetachResult<T>> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<'timer'>((resolve) => {
    timerId = setTimeout(() => resolve('timer'), opts.firstResponseMs);
  });

  const workPromise = opts.work();
  const wrappedWork = workPromise.then(
    (value) => ({ kind: 'work' as const, value }),
    (error) => ({ kind: 'work-error' as const, error }),
  );

  const winner = await Promise.race([
    wrappedWork,
    timer.then((kind) => ({ kind })),
  ]);

  // Sync mode: worker resolved (or threw) before the timer fired.
  if (winner.kind === 'work' || winner.kind === 'work-error') {
    if (timerId !== null) clearTimeout(timerId);
    if (winner.kind === 'work-error') {
      await opts.onError(winner.error).catch(() => undefined);
      throw winner.error;
    }
    await opts.onFinish(winner.value, 'sync').catch(() => undefined);
    opts.onDecision?.('sync');
    return { mode: 'sync', value: winner.value };
  }

  // Background mode: timer fired first. Schedule the terminal write to
  // happen after the still-in-flight worker finishes, via waitUntil.
  const tail = workPromise.then(
    (value) => opts.onFinish(value, 'background').catch(() => undefined),
    (err) => opts.onError(err).catch(() => undefined),
  );

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(tail);
  } else {
    // In test environments waitUntil isn't available; keep a reference so
    // the unhandled rejection doesn't terminate the process.
    void tail;
  }
  opts.onDecision?.('background');
  return { mode: 'background' };
}
