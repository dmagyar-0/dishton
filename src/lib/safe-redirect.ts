// Sanitizes the `next` search param threaded through /auth/login,
// /auth/signup, and /auth/callback so a signed-out visitor (e.g. someone who
// followed a /f/<code> link) lands back where they started after signing in.
//
// Must be a same-origin, relative path only — never let `next` carry the
// browser off Dishton. In particular:
//   - `//evil.com` is a protocol-relative URL: the browser treats the leading
//     `//` as "same scheme, different host".
//   - `/\evil.com` exploits browsers (historically some WebKit/Chromium
//     builds) that treat a backslash the same as a forward slash when
//     resolving a URL, making it behave like `//evil.com`.
//   - Anything without a leading slash (`f/code`) or with a scheme
//     (`https://evil.com`) is an absolute URL, not a same-origin path.
//
// A single leading slash followed by anything other than another slash or a
// backslash covers all three: reject, fall back to '/'.
const SAFE_NEXT_PATTERN = /^\/[^/\\]/;

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  return SAFE_NEXT_PATTERN.test(raw) ? raw : '/';
}
