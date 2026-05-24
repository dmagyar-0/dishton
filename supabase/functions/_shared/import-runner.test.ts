// Unit tests for runWithBackgroundDetach. Verifies the sync/background
// branch selection and that the worker promise keeps running after the
// timer fires (otherwise background-mode imports would silently abort
// whatever the SPA disconnects).

import { assert, assertEquals } from 'jsr:@std/assert';
import { runWithBackgroundDetach } from './import-runner.ts';

Deno.test('runWithBackgroundDetach: returns sync mode when the worker finishes before the timer', async () => {
  const result = await runWithBackgroundDetach({
    totalMs: 1000,
    firstResponseMs: 100,
    run: async () => {
      await new Promise((r) => setTimeout(r, 1));
      return 'hello';
    },
  });
  assertEquals(result.mode, 'sync');
  if (result.mode === 'sync') {
    assertEquals(result.value, 'hello');
  }
});

Deno.test('runWithBackgroundDetach: returns background mode when the timer fires first', async () => {
  let workerCompleted = false;
  const workerPromise: { current: Promise<unknown> | null } = { current: null };
  const result = await runWithBackgroundDetach({
    totalMs: 1000,
    firstResponseMs: 5,
    run: () => {
      const p = (async () => {
        await new Promise((r) => setTimeout(r, 50));
        workerCompleted = true;
        return 'late';
      })();
      workerPromise.current = p;
      return p;
    },
  });
  assertEquals(result.mode, 'background');
  // The worker must still be in flight (or already finished) — never aborted.
  assert(workerPromise.current);
  await workerPromise.current;
  assert(workerCompleted, 'worker promise should run to completion after background detach');
});

Deno.test('runWithBackgroundDetach: invokes onDecision with the chosen mode', async () => {
  const decisions: string[] = [];
  await runWithBackgroundDetach({
    totalMs: 1000,
    firstResponseMs: 100,
    run: async () => 'fast',
    onDecision: (m) => decisions.push(m),
  });
  assertEquals(decisions, ['sync']);

  await runWithBackgroundDetach({
    totalMs: 1000,
    firstResponseMs: 5,
    run: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'slow';
    },
    onDecision: (m) => decisions.push(m),
  });
  assertEquals(decisions, ['sync', 'background']);
});

Deno.test('runWithBackgroundDetach: worker rejection in background mode does not throw', async () => {
  // The worker is responsible for writing terminal state to import_jobs; a
  // thrown error here would tear down the process if not swallowed.
  const result = await runWithBackgroundDetach({
    totalMs: 1000,
    firstResponseMs: 5,
    run: async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new Error('boom');
    },
  });
  assertEquals(result.mode, 'background');
  // Give the worker a beat to settle and the unhandled rejection to fire.
  await new Promise((r) => setTimeout(r, 100));
});
