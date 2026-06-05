// Unit tests for the SSRF guard. Run via `pnpm test:edge`.
//
// The pure range checks (isBlockedIpv4/6) run without any network or DNS. The
// assertPublicUrl + safeFetch tests stub Deno.resolveDns and globalThis.fetch
// so we can exercise the redirect-revalidation path deterministically.

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import {
  SsrfError,
  assertPublicUrl,
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  safeFetch,
} from './ssrf-guard.ts';

Deno.test('isBlockedIpv4 blocks private/loopback/link-local/reserved ranges', () => {
  for (const ip of [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // CGNAT
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
  ]) {
    assert(isBlockedIpv4(ip), `expected ${ip} to be blocked`);
  }
});

Deno.test('isBlockedIpv4 allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
    assertEquals(isBlockedIpv4(ip), false, `expected ${ip} to be allowed`);
  }
});

Deno.test('isBlockedIpv6 blocks loopback/unique-local/link-local/mapped', () => {
  for (const ip of [
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254', // IPv4-mapped metadata
  ]) {
    assert(isBlockedIpv6(ip), `expected ${ip} to be blocked`);
  }
});

Deno.test('isBlockedIpv6 allows public addresses', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assertEquals(isBlockedIpv6(ip), false, `expected ${ip} to be allowed`);
  }
});

Deno.test('isBlockedAddress routes to the right family check', () => {
  assert(isBlockedAddress('10.0.0.1'));
  assert(isBlockedAddress('fe80::1'));
  assertEquals(isBlockedAddress('8.8.8.8'), false);
});

Deno.test('assertPublicUrl rejects non-http(s) schemes', async () => {
  for (const u of ['file:///etc/passwd', 'gopher://x', 'data:text/html,x', 'ftp://x/y']) {
    const err = await assertRejects(() => assertPublicUrl(u), SsrfError);
    assertEquals(err.reason, 'bad_scheme');
  }
});

Deno.test('assertPublicUrl rejects IP-literal private hosts without DNS', async () => {
  const err = await assertRejects(
    () => assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
    SsrfError,
  );
  assertEquals(err.reason, 'private_host');
});

Deno.test('assertPublicUrl rejects a hostname that resolves only to a private IP', async () => {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const original = D.resolveDns;
  D.resolveDns = (_h: string, rt: string) =>
    rt === 'A' ? Promise.resolve(['10.0.0.5']) : Promise.resolve([]);
  try {
    const err = await assertRejects(
      () => assertPublicUrl('http://internal.attacker.test/'),
      SsrfError,
    );
    assertEquals(err.reason, 'private_host');
  } finally {
    D.resolveDns = original;
  }
});

Deno.test('assertPublicUrl accepts a hostname that resolves to a public IP', async () => {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const original = D.resolveDns;
  D.resolveDns = (_h: string, rt: string) =>
    rt === 'A' ? Promise.resolve(['93.184.216.34']) : Promise.resolve([]);
  try {
    const u = await assertPublicUrl('https://example.test/recipe');
    assertEquals(u.hostname, 'example.test');
  } finally {
    D.resolveDns = original;
  }
});

Deno.test('safeFetch rejects a redirect onto a private host', async () => {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const originalResolve = D.resolveDns;
  const originalFetch = globalThis.fetch;
  // public.test resolves public; the redirect target resolves private.
  D.resolveDns = (host: string, rt: string) => {
    if (rt !== 'A') return Promise.resolve([]);
    return Promise.resolve(host === 'public.test' ? ['93.184.216.34'] : ['127.0.0.1']);
  };
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost.test/secret' },
      }),
    )) as typeof fetch;
  try {
    const err = await assertRejects(
      () => safeFetch('https://public.test/start'),
      SsrfError,
    );
    assertEquals(err.reason, 'private_host');
  } finally {
    D.resolveDns = originalResolve;
    globalThis.fetch = originalFetch;
  }
});

Deno.test('safeFetch returns a 2xx response from a public host', async () => {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const originalResolve = D.resolveDns;
  const originalFetch = globalThis.fetch;
  D.resolveDns = (_h: string, rt: string) =>
    rt === 'A' ? Promise.resolve(['93.184.216.34']) : Promise.resolve([]);
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response('<html></html>', { status: 200 }))) as typeof fetch;
  try {
    const res = await safeFetch('https://public.test/recipe');
    assertEquals(res.status, 200);
  } finally {
    D.resolveDns = originalResolve;
    globalThis.fetch = originalFetch;
  }
});
