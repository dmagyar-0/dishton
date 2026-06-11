// Sentry initialisation, called from src/main.tsx before React mounts.
// DSN comes from VITE_SENTRY_DSN_FRONTEND; empty disables Sentry.

import * as Sentry from '@sentry/react';
import { scrubUrl } from '../lib/scrub-url';

// Auth flows put tokens in URLs (PKCE `?code=`, legacy recovery fragments).
// Scrub every URL-shaped field before an event/transaction/breadcrumb leaves
// the browser so Sentry can never store something that mints a session.
function scrubEventUrls<T extends Sentry.Event>(event: T): T {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction);
  return event;
}

function scrubBreadcrumbUrls(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = crumb.data;
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      const value = data[key];
      if (typeof value === 'string') data[key] = scrubUrl(value);
    }
  }
  return crumb;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN_FRONTEND;
  // Empty DSN (local dev) is a clean no-op: no integrations are registered and
  // no network calls are made.
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE_SHA ?? 'dev',
    integrations: [
      Sentry.browserTracingIntegration(),
      // Replays are captured only when an error fires (never proactively) and
      // every text node + media element is masked so cookbook content never
      // leaves the browser — see docs/14-observability.md.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    beforeSend: (event) => scrubEventUrls(event),
    beforeSendTransaction: (event) => scrubEventUrls(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumbUrls(crumb),
  });
}

// Capture an exception explicitly (the ErrorBoundary handles React render
// errors; this is for caught-but-noteworthy failures like a failed save).
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function setUserContext(profileId: string): void {
  Sentry.setUser({ id: profileId });
}

export function clearUserContext(): void {
  Sentry.setUser(null);
}

export function setHouseholdContext(householdId: string | null): void {
  Sentry.setTag('household_id', householdId);
}

// Record a low-noise breadcrumb so unmapped errors keep their raw context in
// Sentry without surfacing internal strings to the user.
export function logErrorBreadcrumb(message: string, data?: Record<string, unknown>): void {
  Sentry.addBreadcrumb({ category: 'error', level: 'warning', message, data });
}
