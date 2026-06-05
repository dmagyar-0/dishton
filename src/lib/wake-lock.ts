// Screen-wake lock used by Cooking Mode. Browsers without Wake Lock
// (Safari < 16.4) silently fall through.

type Sentinel = {
  release: () => Promise<void> | void;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
};

let sentinel: Sentinel | null = null;

async function reacquire(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible' && sentinel === null) {
    try {
      sentinel =
        (await (
          navigator as unknown as { wakeLock?: { request: (k: string) => Promise<Sentinel> } }
        ).wakeLock?.request('screen')) ?? null;
      // Re-add the release listener on the new sentinel; the OS releases the
      // lock when the tab is hidden, so a reacquired lock needs its own
      // listener to keep `sentinel` truthy/null in sync (the original
      // listener was bound to the now-released sentinel).
      sentinel?.addEventListener?.('release', () => {
        sentinel = null;
      });
    } catch {
      /* ignore */
    }
  }
}

export async function acquireWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
  try {
    sentinel =
      (await (
        navigator as unknown as { wakeLock: { request: (k: string) => Promise<Sentinel> } }
      ).wakeLock.request('screen')) ?? null;
    sentinel?.addEventListener?.('release', () => {
      sentinel = null;
    });
    document.addEventListener('visibilitychange', reacquire);
    return true;
  } catch {
    return false;
  }
}

export function releaseWakeLock(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', reacquire);
  }
  void sentinel?.release();
  sentinel = null;
}
