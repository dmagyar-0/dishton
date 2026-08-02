// Shared /f/<code> link builder. FollowCodeCard's "Copy link" action and
// FollowLinkPage's sign-up/log-in `next` param both go through this so the
// route prefix lives in exactly one place.

export function followLinkPath(code: string): string {
  return `/f/${code}`;
}

// Absolute form for clipboard copy, guarded for SSR/test environments where
// `window` is undefined — same guard InviteCodeDialog's local buildShareLink
// already uses for its /onboarding?code= link.
export function buildFollowLink(code: string): string {
  if (typeof window === 'undefined') return followLinkPath(code);
  return `${window.location.origin}${followLinkPath(code)}`;
}
