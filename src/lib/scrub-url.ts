// Auth tokens can transit URLs: PKCE exchange codes (`?code=...`) and, for
// sessions minted before the PKCE switch, implicit-flow fragments
// (`#access_token=...&refresh_token=...`). Anything we report to Sentry must
// drop the fragment entirely and redact token-ish query parameters so a
// captured pageload/navigation URL can never mint a session.

const SENSITIVE_QUERY_PARAMS = /([?&](?:code|token|access_token|refresh_token)=)[^&#]*/gi;

export function scrubUrl(url: string): string {
  return url.replace(/#.*$/, '').replace(SENSITIVE_QUERY_PARAMS, '$1[redacted]');
}
