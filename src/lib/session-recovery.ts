// Self-heal when a mobile browser resumes the PWA after backgrounding.
//
// A backgrounded mobile tab is suspended: timers and JS pause, and any in-flight
// request is left dangling on a connection that may be dead by the time the user
// returns. The query client runs with refetchOnWindowFocus disabled, so nothing
// re-fires those requests on resume — a view that was mid-load (reading a recipe)
// or a mutation that was in flight (deleting one) stays stuck until a manual
// reload. This re-validates the session and refetches the on-screen queries when
// the app comes back to the foreground, so it recovers on its own.

import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

// Only recover after a real backgrounding, not a momentary tab blur, so we don't
// trigger a refetch on every quick focus change.
const MIN_HIDDEN_MS = 10_000;
// Collapse the burst of resume events the browser can fire together (pageshow +
// visibilitychange) into a single recovery.
const DEBOUNCE_MS = 1_000;

export function installSessionRecovery(queryClient: QueryClient): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let hiddenAt: number | null = null;
  let lastRecoverAt = 0;

  const recover = () => {
    const now = Date.now();
    if (now - lastRecoverAt < DEBOUNCE_MS) return;
    lastRecoverAt = now;
    // Nudge Supabase to validate/refresh the token (bounded by the fetch timeout
    // in timeout-fetch.ts), then refetch only the queries currently on screen.
    void supabase.auth.getSession().finally(() => {
      void queryClient.invalidateQueries({ refetchType: 'active' });
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt === null ? Number.POSITIVE_INFINITY : Date.now() - hiddenAt;
    hiddenAt = null;
    if (hiddenFor >= MIN_HIDDEN_MS) recover();
  };

  const onOnline = () => recover();

  const onPageShow = (event: PageTransitionEvent) => {
    // `persisted` means the document was restored from the back/forward cache —
    // e.g. the mobile browser evicted the tab and the user reopened it.
    if (event.persisted) recover();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', onPageShow);
  };
}
