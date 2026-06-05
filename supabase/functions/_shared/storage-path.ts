// Storage-path ownership check shared by the photo import function. The signing
// client uses the service role and bypasses storage RLS, so paths supplied by
// the caller must be confined to the caller's own uid prefix — otherwise a
// caller could sign (and exfiltrate via the vision model) another user's
// uploaded object.

// Returns true when `path` is safely under `${profileId}/` and contains no
// parent-directory traversal.
export function isOwnedStoragePath(path: string, profileId: string): boolean {
  if (path.includes('..')) return false;
  return path.startsWith(`${profileId}/`) && path.length > profileId.length + 1;
}
