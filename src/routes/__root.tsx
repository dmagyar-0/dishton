import * as Sentry from '@sentry/react';
import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext, useMatches } from '@tanstack/react-router';
import '@/lib/i18n';
import { ActiveImportsProvider } from '@/lib/imports/ActiveImportsProvider';
import { ServiceWorkerUpdateToast } from '@/lib/sw-update-toast';
import { Toaster } from '@/ui/primitives/Toast';
import { AppShell } from '@/ui/shell/AppShell';

type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootShell,
});

// User-facing fallback for any uncaught React render error. The exception is
// already reported to Sentry by the surrounding Sentry.ErrorBoundary; this is
// purely the recovery UI. A full reload is the safest recovery for a corrupted
// render tree.
function ErrorFallback() {
  return (
    <div
      role="alert"
      className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-paper px-6 text-center text-aubergine"
    >
      <h1 className="font-display text-2xl">Something went wrong.</h1>
      <p className="max-w-sm text-sm opacity-80">
        We hit an unexpected error and have been notified. Reloading usually fixes it.
      </p>
      <button
        type="button"
        className="rounded-[var(--radius-md)] bg-aubergine px-4 py-2 text-paper shadow-press"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

function RootShell() {
  const matches = useMatches();
  const onAuthRoute = matches.some((m) => m.routeId.startsWith('/auth/'));
  // Public share pages (/r/<token>) render their own minimal frame: anon
  // visitors have no memberships for the AppShell nav or imports provider.
  const onPublicRoute = matches.some((m) => m.routeId.startsWith('/r/'));
  // ActiveImportsProvider wraps the app shell (not the auth routes) so it
  // sees route changes and survives navigation, but doesn't run while the
  // user is on the login screen with no profile to subscribe under.
  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      {onAuthRoute || onPublicRoute ? (
        <Outlet />
      ) : (
        <ActiveImportsProvider>
          <AppShell />
        </ActiveImportsProvider>
      )}
      <Toaster />
      <ServiceWorkerUpdateToast />
    </Sentry.ErrorBoundary>
  );
}
