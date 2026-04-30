import { useAuth } from '@/lib/auth';
import { redirect } from '@tanstack/react-router';

export const requireAuth = () => {
  const s = useAuth.getState();
  if (!s.session) throw redirect({ to: '/auth/login' });
};

export const requireHousehold = () => {
  requireAuth();
  const s = useAuth.getState();
  if (s.memberships.length === 0) throw redirect({ to: '/onboarding' });
};
