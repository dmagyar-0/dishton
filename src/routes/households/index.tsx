import { useAuth } from '@/lib/auth';
import { SharingSection } from '@/ui/household/SharingSection';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../_guards';

export const Route = createFileRoute('/households/')({
  beforeLoad: requireHousehold,
  component: HouseholdsPage,
});

// The Households surface: a top-level home for everything about who you follow
// and who follows you. It hosts the same relationships UI that used to live on
// the Settings "Sharing" tab (follow codes, the followed list, and followers),
// scoped to the signed-in user's canonical household.
function HouseholdsPage() {
  const { t } = useTranslation();
  const memberships = useAuth((s) => s.memberships);
  // Canonical household for relationships: prefer the personal household so the
  // followed list, add_follow target, and share codes all agree on a single
  // household — matching how AppShell picks the household for header links.
  const membership = useMemo(
    () => memberships.find((m) => m.is_personal) ?? memberships[0],
    [memberships],
  );
  const householdId = membership?.household_id ?? '';
  const isOwner = membership?.role === 'owner';

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-2">{t('households.title')}</h1>
      <p className="text-ink-soft mb-6">{t('households.subtitle')}</p>
      {householdId && <SharingSection householdId={householdId} isOwner={isOwner} />}
    </main>
  );
}
