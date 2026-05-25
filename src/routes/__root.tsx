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

function RootShell() {
  const matches = useMatches();
  const onAuthRoute = matches.some((m) => m.routeId.startsWith('/auth/'));
  // ActiveImportsProvider wraps the app shell (not the auth routes) so it
  // sees route changes and survives navigation, but doesn't run while the
  // user is on the login screen with no profile to subscribe under.
  return (
    <>
      {onAuthRoute ? (
        <Outlet />
      ) : (
        <ActiveImportsProvider>
          <AppShell />
        </ActiveImportsProvider>
      )}
      <Toaster />
      <ServiceWorkerUpdateToast />
    </>
  );
}
