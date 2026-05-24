// Unit tests for runWithBackgroundDetach. Verifies the sync/background
// branch selection, mode-aware onFinish dispatch, and that the worker
// promise keeps running after the timer fires (otherwise background-mode
// imports would silently abort whatever the SPA disconnects).

import { assert, assertEquals } from 'jsr:@std/assert';
import { runWithBackgroundDetach } from './import-runner.ts';

Deno.test('runWithBackgroundDetach: returns sync mode + invokes onFinish(sync) when work finishes before the timer', async () => {
  const finishCalls: Array<{ value: string; mode: string }> = [];
  const result = await runWithBackgroundDetach({
    firstResponseMs: 100,
    work: async () => {
      await new Promise((r) => setTimeout(r, 1));
      return 'hello';
    },
    onFinish: async (value, mode) => {
      finishCalls.push({ value, mode });
    },
    onError: async () => {},
  });
  assertEquals(result.mode, 'sync');
  if (result.mode === 'sync') assertEquals(result.value, 'hello');
  assertEquals(finishCalls, [{ value: 'hello', mode: 'sync' }]);
});

Deno.test('runWithBackgroundDetach: returns background mode + onFinish(background) eventually runs', async () => {
  const finishCalls: Array<{ value: string; mode: string }> = [];
  let finishResolved!: () => void;
  const finishDone = new Promise<void>((r) => {
    finishResolved = r;
  });
  const result = await runWithBackgroundDetach({
    firstResponseMs: 5,
    work: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'late';
    },
    onFinish: async (value, mode) => {
      finishCalls.push({ value, mode });
      finishResolved();
    },
    onError: async () => {},
  });
  assertEquals(result.mode, 'background');
  // Wait for the background tail to flush before asserting.
  await finishDone;
  assertEquals(finishCalls, [{ value: 'late', mode: 'background' }]);
});

Deno.test('runWithBackgroundDetach: sync-mode worker throw routes through onError and rethrows', async () => {
  const errors: unknown[] = [];
  let threw = false;
  try {
    await runWithBackgroundDetach({
      firstResponseMs: 100,
      work: async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error('sync boom');
      },
      onFinish: async () => {},
      onError: async (e) => {
        errors.push(e);
      },
    });
  } catch (e) {
    threw = true;
    assert(e instanceof Error);
    assertEquals(e.message, 'sync boom');
  }
  assert(threw, 'sync-mode worker error should rethrow');
  assertEquals(errors.length, 1);
});

Deno.test('runWithBackgroundDetach: background-mode worker throw routes through onError without throwing on the calling side', async () => {
  const errors: unknown[] = [];
  let errorResolved!: () => void;
  const errorDone = new Promise<void>((r) => {
    errorResolved = r;
  });
  const result = await runWithBackgroundDetach({
    firstResponseMs: 5,
    work: async () => {
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('bg boom');
    },
    onFinish: async () => {},
    onError: async (e) => {
      errors.push(e);
      errorResolved();
    },
  });
  assertEquals(result.mode, 'background');
  await errorDone;
  assertEquals(errors.length, 1);
});

Deno.test('runWithBackgroundDetach: invokes onDecision with the chosen mode', async () => {
  const decisions: string[] = [];
  await runWithBackgroundDetach({
    firstResponseMs: 100,
    work: async () => 'fast',
    onFinish: async () => {},
    onError: async () => {},
    onDecision: (m) => decisions.push(m),
  });
  assertEquals(decisions, ['sync']);

  let finishResolved!: () => void;
  const finishDone = new Promise<void>((r) => {
    finishResolved = r;
  });
  await runWithBackgroundDetach({
    firstResponseMs: 5,
    work: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'slow';
    },
    onFinish: async () => finishResolved(),
    onError: async () => {},
    onDecision: (m) => decisions.push(m),
  });
  await finishDone;
  assertEquals(decisions, ['sync', 'background']);
});
