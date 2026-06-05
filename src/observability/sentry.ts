// Sentry initialisation, called from src/main.tsx before React mounts.
// DSN comes from VITE_SENTRY_DSN_FRONTEND; empty disables Sentry.

import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN_FRONTEND;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE_SHA ?? 'dev',
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
  });
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
