import { useAuth } from '@/lib/auth';
import { redirect } from '@tanstack/react-router';

export const requireAuth = () => {
  const s = useAuth.getState();
  if (!s.session) throw redirect({ to: '/auth/login' });
};
