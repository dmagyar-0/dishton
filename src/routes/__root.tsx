import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext, useMatches } from '@tanstack/react-router';
import '@/lib/i18n';
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
  return (
    <>
      {onAuthRoute ? <Outlet /> : <AppShell />}
      <Toaster />
      <ServiceWorkerUpdateToast />
    </>
  );
}
