import { useAuth } from '@/lib/auth';
import { redirect } from '@tanstack/react-router';

// Route guards run in TanStack Router `beforeLoad`. The auth store is hydrated
// from Supabase's persisted session in main.tsx *before* the router mounts, so
// by the time any guard runs `hydrated` should be true. We still gate on it
// defensively: a guard that fires mid-hydration must not bounce a user with a
// valid-but-restoring session to /auth/login (the spurious-redirect bug). If we
// are ever called before hydration completes, do nothing and let the route
// render — the auth-driven redirects re-evaluate once the store settles.
export const requireAuth = () => {
  const s = useAuth.getState();
  if (!s.hydrated) return;
  if (!s.session) throw redirect({ to: '/auth/login' });
};

// Auth + at least one household membership. Only redirects to /onboarding once
// the store is hydrated AND we actually have a session, so a not-yet-loaded
// membership list can't wrongly send a signed-in user to onboarding.
export const requireHousehold = () => {
  const s = useAuth.getState();
  if (!s.hydrated) return;
  if (!s.session) throw redirect({ to: '/auth/login' });
  if (s.memberships.length === 0) throw redirect({ to: '/onboarding' });
};
