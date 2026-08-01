// First-party product analytics. Events are written directly to
// app.analytics_events by the browser (INSERT-only RLS, see
// supabase/migrations/20260801120000_product_metrics.sql) -- there is no
// third-party SDK involved, in keeping with the app's "cookbook content never
// leaves the browser" posture (see docs/14-observability.md).
//
// Hard privacy rules, enforced here in code rather than by convention alone:
//   - props are a small allowlist of SCALAR values only (string/number/
//     boolean/null) -- unknown keys are stripped before an event is queued.
//   - never a recipe title/body/URL, a search query, or an email address.
//
// This is a complete no-op when the visitor is signed out or when the
// VITE_FEATURE_ANALYTICS build flag is off: no queue is built, no timer is
// armed, and no listener is installed.
//
// Analytics must never sit on a latency-critical path or surface an error to
// the user: track() never throws, and a failed flush drops its batch silently
// instead of retrying (no retry-storm against a struggling backend).

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type AnalyticsEvent =
  | 'app_open'
  | 'app_resume'
  | 'import_started'
  | 'import_succeeded'
  | 'import_failed'
  | 'edge_call'
  | 'recipe_viewed'
  | 'search_performed'
  | 'signup_completed';

type PropScalar = string | number | boolean | null;
export type AnalyticsProps = Record<string, PropScalar>;

// The full set of prop keys any call site is allowed to send, across every
// event above. Anything not listed here is dropped in sanitizeProps() --
// this is the enforcement point, not just documentation.
const ALLOWED_PROP_KEYS = new Set([
  'kind', // import kind: 'url' | 'instagram' | 'photo' | 'manual'
  'source', // signup/auth source
  'method', // signup method: 'email' | 'google'
  'error_code', // known i18n error key (see errors.* in import.tsx)
  'latency_ms', // measured duration of a client-side operation
  'ms', // edge_call round-trip time
  'status', // HTTP-ish status observed for an edge_call
  'fn', // Edge Function name for an edge_call
  'outcome', // edge_call outcome (see src/lib/invoke-function.ts)
  'result_count', // number of results for a search
]);

const MAX_QUEUE = 16;
const FLUSH_MS = 5000;
const SESSION_STORAGE_KEY = 'dishton.analytics.session_id';
const MAX_STRING_PROP_LEN = 200;

type QueuedRow = {
  profile_id: string;
  session_id: string;
  event: AnalyticsEvent;
  props: AnalyticsProps;
  release_sha: string | null;
  display_mode: 'standalone' | 'browser';
};

let queue: QueuedRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let cachedSessionId: string | null = null;
let listenersInstalled = false;

function isEnabled(): boolean {
  const v = (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_ANALYTICS;
  return v === 'true' || v === '1';
}

function currentProfileId(): string | null {
  return useAuth.getState().session?.user?.id ?? null;
}

function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
  } catch {
    /* private mode / storage disabled -- fall through to a fresh id */
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    /* best effort only; the id still works for this page's lifetime */
  }
  cachedSessionId = id;
  return id;
}

function displayMode(): 'standalone' | 'browser' {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) {
      return 'standalone';
    }
  } catch {
    /* matchMedia unsupported in this environment -- default to 'browser' */
  }
  return 'browser';
}

function sanitizeProps(props: AnalyticsProps): AnalyticsProps {
  const out: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      value !== null
    ) {
      continue;
    }
    out[key] = typeof value === 'string' ? value.slice(0, MAX_STRING_PROP_LEN) : value;
  }
  return out;
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

// Flush = one batched insert. Failures (network down, RLS rejection, an
// unlucky offline moment) drop the batch silently -- analytics must never
// retry-storm a struggling backend or surface an error to the user.
async function flush(): Promise<void> {
  clearFlushTimer();
  if (queue.length === 0) return;
  const rows = queue;
  queue = [];
  try {
    await supabase.from('analytics_events').insert(rows);
  } catch {
    /* dropped -- see module doc comment */
  }
}

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush());
  }
}

export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (!isEnabled()) return;
  if (typeof window === 'undefined') return;
  const profileId = currentProfileId();
  if (!profileId) return;

  ensureListeners();

  queue.push({
    profile_id: profileId,
    session_id: getSessionId(),
    event,
    props: sanitizeProps(props),
    release_sha: (import.meta.env.VITE_RELEASE_SHA as string | undefined) ?? null,
    display_mode: displayMode(),
  });

  if (queue.length >= MAX_QUEUE) {
    clearFlushTimer();
    void flush();
  } else {
    scheduleFlush();
  }
}
