// SSRF guard for user-supplied import URLs. The import-url function fetches an
// arbitrary URL the user pastes; without a guard a user could point it at a
// link-local metadata endpoint (169.254.169.254), a loopback service, or an
// internal RFC1918 host and exfiltrate the response (or the eventual draft) —
// a classic server-side request forgery. This module:
//
//   1. Rejects non-http(s) schemes (file:, gopher:, data:, etc.).
//   2. Resolves the hostname to its A/AAAA records and rejects any address in a
//      private / loopback / link-local / reserved range (v4 and v6, including
//      IPv4-mapped IPv6).
//   3. Provides safeFetch(), which follows redirects MANUALLY and re-validates
//      every hop before connecting, so a public host can't 30x us onto an
//      internal one.
//
// DNS-rebinding note: resolveDns + fetch is a check-then-use with a tiny TOCTOU
// window (the name could re-resolve between our check and fetch's own
// resolution). Eliminating it fully needs pinning the resolved IP into the
// connection, which Deno's fetch does not expose. We accept the residual risk;
// the dominant attack (a URL whose name resolves only to a private IP) is
// blocked, and each redirect hop is re-checked.

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

const MAX_REDIRECTS = 3;

export class SsrfError extends Error {
  constructor(public reason: 'bad_scheme' | 'private_host' | 'dns_failed' | 'too_many_redirects') {
    super(reason);
    this.name = 'SsrfError';
  }
}

// IPv4 dotted-quad → 32-bit number, or null when not a valid IPv4 literal.
function ipv4ToInt(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc >>> 0;
}

// Private / loopback / link-local / reserved IPv4 ranges. Returns true when the
// dotted-quad address must be blocked.
export function isBlockedIpv4(host: string): boolean {
  const n = ipv4ToInt(host);
  if (n === null) return false;
  const inRange = (base: string, bits: number): boolean => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (baseInt & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this network" / 0.0.0.0
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / broadcast
  );
}

// Block loopback, unique-local (fc00::/7), link-local (fe80::/10), unspecified,
// and IPv4-mapped addresses whose embedded v4 is itself blocked. The input is a
// textual IPv6 address as returned by Deno.resolveDns.
export function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase().split('%')[0] ?? '';
  if (lower === '::1' || lower === '::') return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — defer to the v4 check.
  const mapped = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  // Expand the first hextet to compare prefixes without full normalization.
  const firstHextet = lower.split(':')[0] ?? '';
  if (firstHextet === '') return false; // e.g. "::x" forms handled above
  const head = Number.parseInt(firstHextet.padStart(4, '0').slice(0, 4), 16);
  if (Number.isNaN(head)) return false;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

export function isBlockedAddress(addr: string): boolean {
  return addr.includes(':') ? isBlockedIpv6(addr) : isBlockedIpv4(addr);
}

// Resolve a hostname and return true if EVERY resolved address is safe. A host
// with no resolvable address, or any address in a blocked range, is rejected.
async function hostnameResolvesPublic(hostname: string): Promise<boolean> {
  // A bare IP literal needs no DNS lookup.
  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) return false;
  const literal = ipv4ToInt(hostname) !== null || hostname.includes(':');
  if (literal) return true; // already proven not-blocked above

  if (!Deno?.resolveDns) {
    // Without a resolver we cannot vet the host; fail closed.
    throw new SsrfError('dns_failed');
  }
  const addrs: string[] = [];
  for (const rt of ['A', 'AAAA'] as const) {
    try {
      const res = await Deno.resolveDns(hostname, rt);
      if (Array.isArray(res)) addrs.push(...res);
    } catch {
      // No record of this type is fine; another type may resolve.
    }
  }
  if (addrs.length === 0) throw new SsrfError('dns_failed');
  return addrs.every((a) => !isBlockedAddress(a));
}

// Validate scheme + resolved host. Throws SsrfError on any violation.
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError('bad_scheme');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError('bad_scheme');
  }
  const hostname = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!(await hostnameResolvesPublic(hostname))) {
    throw new SsrfError('private_host');
  }
  return u;
}

// Fetch a public URL, following redirects manually and re-validating every hop.
// Each Location is resolved against the current URL and re-checked before we
// connect to it, so a public host cannot bounce us onto a private one.
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = (await assertPublicUrl(rawUrl)).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res; // 3xx without Location — let caller handle it
    // Drain the redirect body so the connection can be reused/closed cleanly.
    await res.body?.cancel();
    const next = new URL(location, current);
    await assertPublicUrl(next.toString());
    current = next.toString();
  }
  throw new SsrfError('too_many_redirects');
}
