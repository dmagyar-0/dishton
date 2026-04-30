import { useAuth } from '@/lib/auth';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const s = useAuth.getState();
    if (!s.session) throw redirect({ to: '/auth/login' });
    if (s.memberships.length === 0) throw redirect({ to: '/onboarding' });
    const first = s.memberships[0];
    if (!first) throw redirect({ to: '/onboarding' });
    throw redirect({ to: '/h/$householdId', params: { householdId: first.household_id } });
  },
});
