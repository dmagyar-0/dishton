import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { bootstrapAuth } from './lib/auth';
import { initSentry } from './observability/sentry';
import { routeTree } from './routeTree.gen';
import './styles/global.css';

initSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

// Hydrate the auth store from Supabase's persisted session before mounting
// the router so route guards see the real session on a hard refresh instead
// of the empty initial state (which would bounce the user to /auth/login).
// On failure we still render — the user just lands on the login page, which
// is the correct outcome when the token can't be refreshed.
void bootstrapAuth()
  .catch((err) => {
    console.error('[auth] bootstrap failed', err);
  })
  .finally(() => {
    createRoot(rootEl).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  });
