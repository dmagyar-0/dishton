// withTimeout: race a promise against a wall-clock budget, with an
// AbortSignal handed back to the caller so in-flight fetches can be cut
// short. Throws HttpError(504, 'timeout') when the timer fires.
//
// Each import edge function wraps its inline body in withTimeout(30_000,
// req.signal, ...) so the existing try/catch can write `failed` to the DB
// before the runtime hard-kills the worker.

import { HttpError } from './auth.ts';

export async function withTimeout<T>(
  ms: number,
  parent: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  const onParent = () => ac.abort(parent!.reason);
  if (parent) {
    if (parent.aborted) ac.abort(parent.reason);
    else parent.addEventListener('abort', onParent);
  }
  const timeoutErr = new HttpError(504, 'timeout');
  const timer = setTimeout(() => ac.abort(timeoutErr), ms);
  try {
    return await Promise.race([
      fn(ac.signal),
      new Promise<never>((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(ac.signal.reason));
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParent);
  }
}
