import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../_guards';

export const Route = createFileRoute('/following/')({
  beforeLoad: requireHousehold,
  component: FollowingPage,
});

function FollowingPage() {
  const { t } = useTranslation();
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.following')}</h1>
      <Card className="p-6">
        <EmptyState
          title="No followed kitchens yet"
          description="Add a follow code from another household to browse their recipes here."
          action={null}
        />
      </Card>
    </main>
  );
}
