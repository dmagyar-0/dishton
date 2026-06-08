// Unit tests for runDetached. The worker always runs post-response via
// EdgeRuntime.waitUntil; runDetached returns immediately (does not await work),
// routes the resolved value to onFinish, and routes a throw to onError.

import { assert, assertEquals } from 'jsr:@std/assert';
import { runDetached } from './import-runner.ts';

Deno.test('runDetached: returns before work completes', async () => {
  let finished = false;
  let tailRan = false;
  let release!: () => void;
  // Gate the worker on a promise (no timer) so the test leaves no dangling op:
  // runDetached must return while the worker is still suspended on the gate.
  const gate = new Promise<void>((r) => (release = r));
  runDetached({
    work: async () => {
      await gate;
      finished = true;
      return 'x';
    },
    onFinish: async () => {
      tailRan = true;
    },
    onError: async () => {},
  });
  // Synchronously after runDetached returned, the worker has not progressed.
  assertEquals(finished, false);
  // Let it finish and flush microtasks so nothing leaks into the next test.
  release();
  while (!tailRan) await Promise.resolve();
  assertEquals(finished, true);
});

Deno.test('runDetached: routes the worker value to onFinish', async () => {
  const calls: string[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  runDetached({
    work: async () => 'hello',
    onFinish: async (v) => {
      calls.push(v);
      resolve();
    },
    onError: async () => {},
  });
  await done;
  assertEquals(calls, ['hello']);
});

Deno.test('runDetached: routes a worker throw to onError', async () => {
  const errors: unknown[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  runDetached({
    work: async () => {
      throw new Error('boom');
    },
    onFinish: async () => {},
    onError: async (e) => {
      errors.push(e);
      resolve();
    },
  });
  await done;
  assertEquals(errors.length, 1);
  assert(errors[0] instanceof Error);
});
