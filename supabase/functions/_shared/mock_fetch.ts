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
        return await replayable(res);
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

// Hand back a fresh Response carrying the same status, headers and body,
// leaving `res` unread so a handler that returns one canned Response can serve
// it to every matching call.
//
// This deliberately does NOT use `res.clone()`. A cloned Response is not fully
// equivalent for consumers that branch on content-type: the Anthropic SDK reads
// `response.headers.get('content-type')` to decide between `.json()` and
// `.text()`, and against a clone it takes the `.text()` branch and resolves the
// call to an unparsed JSON string. Every callAndValidate test then died on
// `resp.content` being undefined. Rebuilding the Response keeps the mock
// transparent to that check.
async function replayable(res: Response): Promise<Response> {
  // 204/205/304 must not carry a body; `new Response(body, ...)` throws if one
  // is supplied for those statuses.
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  const body = nullBody ? null : await res.clone().arrayBuffer();
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
