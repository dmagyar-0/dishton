import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { useEffect } from 'react';
import '@/lib/i18n';
import { bootstrapAuth } from '@/lib/auth';
import { ServiceWorkerUpdateToast } from '@/lib/sw-update-toast';
import { Toaster } from '@/ui/primitives/Toast';

type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootShell,
});

function RootShell() {
  useEffect(() => {
    void bootstrapAuth();
  }, []);
  return (
    <>
      <Outlet />
      <Toaster />
      <ServiceWorkerUpdateToast />
    </>
  );
}
