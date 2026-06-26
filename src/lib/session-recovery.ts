// Self-heal when a mobile browser resumes the PWA after backgrounding.
//
// A backgrounded mobile tab is suspended: timers and JS pause, and any in-flight
// request is left dangling on a connection that may be dead by the time the user
// returns. The query client runs with refetchOnWindowFocus disabled, so nothing
// re-fires those requests on resume — a view that was mid-load (reading a recipe)
// or a mutation that was in flight (deleting one) stays stuck until a manual
// reload. This re-validates the session and refetches the on-screen queries when
// the app comes back to the foreground, so it recovers on its own. If that
// validation never settles — the app is truly wedged — it reloads as a last
// resort, automating the manual refresh a user would otherwise reach for.

import type { QueryClient } from '@tanstack/react-query';
import { captureException, logErrorBreadcrumb } from '../observability/sentry';
import { supabase } from './supabase';

// Only recover after a real backgrounding, not a momentary tab blur, so we don't
// trigger a refetch on every quick focus change.
const MIN_HIDDEN_MS = 10_000;
// Collapse the burst of resume events the browser can fire together (pageshow +
// visibilitychange) into a single recovery.
const DEBOUNCE_MS = 1_000;
// Safety net: if validating the session on resume hasn't settled within this
// window, treat the app as wedged and reload — automating the manual refresh
// that recovers it. Comfortably longer than the auth lock's 5s acquire timeout
// and a slow-but-progressing refresh, yet shorter than the 30s fetch timeout a
// dead-socket request would otherwise hang for, so a genuine hang reloads at
// ~12s instead of stranding the user.
const WEDGE_RELOAD_MS = 12_000;
// Never reload more than once per window — a backend that is genuinely down must
// not trap the tab in a reload loop. Survives the reload via sessionStorage.
const RELOAD_GUARD_KEY = 'dishton.recovery.reloaded_at';
const RELOAD_GUARD_MS = 60_000;

function reloadIfNotLooping(trigger: string): void {
  // Offline: a reload can't re-validate the session and only flashes the app
  // shell. Wait for the `online` event to drive another recovery instead.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
  } catch {
    /* private mode / storage disabled — best effort */
  }
  if (Date.now() - lastReloadAt < RELOAD_GUARD_MS) return;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  // The wedge is otherwise silent (no exception is ever thrown — the app just
  // hangs), so the prior fix rounds had no signal. Capture it: this is the only
  // place we learn that a real user hit the resume-freeze in the wild.
  captureException(new Error('session-recovery: app wedged on resume, reloading'), {
    trigger,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
  });
  window.location.reload();
}

export function installSessionRecovery(queryClient: QueryClient): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let hiddenAt: number | null = null;
  let lastRecoverAt = 0;

  const recover = (trigger: string) => {
    const now = Date.now();
    if (now - lastRecoverAt < DEBOUNCE_MS) return;
    lastRecoverAt = now;
    logErrorBreadcrumb('session-recovery: recover', { trigger });
    // Reconnect the Realtime socket if it died while backgrounded. A throttled
    // heartbeat makes the server silently drop the socket; the worker +
    // heartbeatCallback in supabase.ts reconnect on the next heartbeat, but
    // force it now so every channel (import jobs, recipe chat) rejoins
    // immediately instead of waiting up to a heartbeat interval — and so the
    // channels other than import jobs, which have no resume handling of their
    // own, recover at all.
    if (!supabase.realtime.isConnected()) {
      supabase.realtime.connect();
    }
    // Nudge Supabase to validate/refresh the token (bounded by the fetch timeout
    // in timeout-fetch.ts), then refetch only the queries currently on screen.
    // The in-memory auth lock (supabase.ts) should keep this from ever wedging,
    // but as a last resort an unsettled validation past WEDGE_RELOAD_MS reloads.
    let settled = false;
    const watchdog = window.setTimeout(() => {
      if (!settled) reloadIfNotLooping(trigger);
    }, WEDGE_RELOAD_MS);
    void supabase.auth.getSession().finally(() => {
      settled = true;
      window.clearTimeout(watchdog);
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
    if (hiddenFor >= MIN_HIDDEN_MS) recover('visibilitychange');
  };

  const onOnline = () => recover('online');

  const onPageShow = (event: PageTransitionEvent) => {
    // `persisted` means the document was restored from the back/forward cache —
    // e.g. the mobile browser evicted the tab and the user reopened it.
    if (event.persisted) recover('pageshow');
  };

  // Page Lifecycle API: Android Chrome aggressively *freezes* (and may discard)
  // a long-backgrounded tab. A freeze can suspend the page without a clean
  // hidden→visible `visibilitychange` pair reaching us, and `resume` is the
  // authoritative "we were frozen, the socket and any in-flight request are
  // almost certainly dead now" signal — so always recover on it, bypassing the
  // MIN_HIDDEN_MS gate that only guards the momentary-blur case.
  const onFreeze = () => {
    hiddenAt = Date.now();
  };
  const onResume = () => recover('resume');

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', onPageShow);
  };
}
