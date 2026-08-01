import { AdminMetricsPage } from '@/ui/admin/AdminMetricsPage';
import { createFileRoute } from '@tanstack/react-router';
import { requireAppAdmin, requireAuth } from '../_guards';

// Admin-only product/reliability dashboard (plan section 5). Gated on TWO
// checks in beforeLoad:
//   1. requireAuth -- the synchronous session check every authed route uses.
//   2. requireAppAdmin -- the async app.is_app_admin() RPC check (see
//      src/routes/_guards.ts for the hydration-race defence and the
//      fail-closed rationale).
//
// A non-admin is redirected to '/' -- never shown a "forbidden" page or a
// partially-loaded dashboard, and never told anything that distinguishes
// "this route doesn't exist" from "you're signed in but not an admin". The
// component below assumes every render already passed both checks.
export const Route = createFileRoute('/admin/metrics')({
  beforeLoad: async () => {
    requireAuth();
    await requireAppAdmin();
  },
  component: AdminMetricsPage,
});
