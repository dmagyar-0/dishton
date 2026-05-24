import { useAuth } from '@/lib/auth';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const s = useAuth.getState();
    if (!s.session) throw redirect({ to: '/auth/login' });
    // Every signed-in profile has a personal household after the
    // 20260524 migration. Prefer that one so the URL stays stable
    // across multiple memberships; fall back to any other membership
    // for legacy accounts the migration hasn't reached yet.
    const personal = s.memberships.find((m) => m.is_personal);
    const first = personal ?? s.memberships[0];
    if (!first) throw redirect({ to: '/onboarding' });
    throw redirect({ to: '/h/$householdId', params: { householdId: first.household_id } });
  },
});
