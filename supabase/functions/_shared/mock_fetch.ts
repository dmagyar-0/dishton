// Test-time fetch mock used by Deno test suites. Installs over globalThis.fetch
// for the duration of a test, asserts request URL/headers/body shape, and
// returns canned responses.
//
// Used pattern (Deno):
//   using mock = installMockFetch([{ url: '...', body: { ... }, response: ... }]);
//   // run test ...
//
// `using` calls [Symbol.dispose]() automatically.

export type MockHandler = {
  match: (req: Request) => boolean;
  response: Response | (() => Response | Promise<Response>);
};

export function installMockFetch(handlers: MockHandler[]): { calls: Request[] } & Disposable {
  const original = globalThis.fetch;
  const calls: Request[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push(req.clone());
    for (const h of handlers) {
      if (h.match(req)) {
        const res = typeof h.response === 'function' ? await h.response() : h.response;
        return res.clone();
      }
    }
    throw new Error(`mock_fetch: no handler matched ${req.method} ${req.url}`);
  }) as typeof fetch;

  return {
    calls,
    [Symbol.dispose]() {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
