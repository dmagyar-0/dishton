import { describe, expect, it, vi } from 'vitest';
import { createTimeoutFetch } from './timeout-fetch';

const REST = 'https://proj.supabase.co/rest/v1/recipes?select=*';
const FUNCTIONS = 'https://proj.supabase.co/functions/v1/import';

// A fetch that only ever settles when its abort signal fires — i.e. it models a
// request hanging on a dead socket. Lets us prove the wrapper, not the network,
// is what ends the request.
function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject((init.signal as AbortSignal).reason ?? new Error('aborted')),
      );
    });
  }) as unknown as typeof fetch;
}

describe('createTimeoutFetch', () => {
  it('aborts a non-functions request that exceeds the timeout', async () => {
    const f = createTimeoutFetch(hangingFetch(), 20);
    await expect(f(REST)).rejects.toBeTruthy();
  });

  it('does NOT apply a timeout to Edge Function requests', async () => {
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      // No timeout signal is injected for /functions/, so a slow AI import is
      // free to run for as long as it needs.
      expect(init?.signal).toBeUndefined();
      return Promise.resolve(new Response('ok'));
    }) as unknown as typeof fetch;

    const f = createTimeoutFetch(base, 20);
    const res = await f(FUNCTIONS);
    expect(await res.text()).toBe('ok');
  });

  it('passes a successful response straight through', async () => {
    const base = vi.fn(() => Promise.resolve(new Response('hi'))) as unknown as typeof fetch;
    const f = createTimeoutFetch(base, 1000);
    const res = await f(REST);
    expect(await res.text()).toBe('hi');
  });

  it("honors the caller's own abort signal independently of the timeout", async () => {
    const f = createTimeoutFetch(hangingFetch(), 10_000);
    const controller = new AbortController();
    const promise = f(REST, { signal: controller.signal });
    controller.abort(new Error('caller-cancelled'));
    await expect(promise).rejects.toThrow('caller-cancelled');
  });
});
