import { useAuth } from '@/lib/auth';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireAuth } from './_guards';

export const Route = createFileRoute('/profile')({
  beforeLoad: requireAuth,
  component: ProfilePage,
});

function ProfilePage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.profile')}</h1>
      <Card className="p-6 space-y-3">
        <p>
          <span className="text-ink-soft text-sm">Display name</span>
          <br />
          <strong className="font-display text-xl">
            {auth.profile?.display_name ?? 'Loading…'}
          </strong>
        </p>
        <p className="text-ink-soft text-sm">{auth.user?.email}</p>
        <Button
          variant="ghost"
          onClick={async () => {
            await auth.signOut();
            await nav({ to: '/auth/login' });
          }}
        >
          Sign out
        </Button>
      </Card>
    </main>
  );
}
