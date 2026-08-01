import { useAuth } from '@/lib/auth';
import { fetchIsAppAdmin } from '@/lib/queries/metrics';
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

// Admin-only routes (currently just /admin/metrics). Unlike requireAuth and
// requireHousehold, "is this user an admin" isn't part of the synchronous
// auth store -- it lives server-side in app.app_admins, reachable only via
// the is_app_admin() RPC (see supabase/migrations/20260801120000_product_metrics.sql).
// So this guard is async, and TanStack Router's `beforeLoad` supports that.
//
// Same hydration defence as requireAuth/requireHousehold above, for the same
// reason: a guard that fires mid-hydration must not bounce a real admin whose
// session is still restoring. We go a step further here and fail CLOSED on
// every other uncertain outcome (RPC error, thrown exception) via
// fetchIsAppAdmin -- an admin-only route leaking on a transient network
// blip is worse than an admin occasionally having to retry the navigation.
// A non-admin is redirected to '/' rather than shown any admin-shaped UI or
// error, so a probe can't distinguish "route doesn't exist" from "you're not
// allowed" (see the route's own comment for why that matters).
export const requireAppAdmin = async () => {
  const s = useAuth.getState();
  if (!s.hydrated) return;
  if (!s.session) throw redirect({ to: '/auth/login' });
  const isAdmin = await fetchIsAppAdmin();
  if (!isAdmin) throw redirect({ to: '/' });
};
