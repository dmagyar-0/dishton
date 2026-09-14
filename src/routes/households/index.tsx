import { useAuth } from '@/lib/auth';
import { resolveManagedHousehold } from '@/lib/canonical-household';
import { useMyHouseholds } from '@/lib/queries/households';
import { SharingSection } from '@/ui/household/SharingSection';
import { Select } from '@/ui/primitives/Select';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../_guards';

export const Route = createFileRoute('/households/')({
  beforeLoad: requireHousehold,
  component: HouseholdsPage,
});

// The Households surface: a top-level home for everything about who you follow
// and who follows you. It hosts the same relationships UI that used to live on
// the Settings "Sharing" tab (follow codes, the followed list, and followers).
//
// Follows are held per household, so this page has to be scoped to one of them.
// It used to be hardwired to the canonical (personal-preferred) household with
// no way to change it, which meant a user whose follow lived on a SHARED
// household saw "You are not following any households yet" and had no route to
// those recipes at all. Multi-household users now get a switcher; everyone else
// sees exactly what they saw before.
function HouseholdsPage() {
  const { t } = useTranslation();
  const memberships = useAuth((s) => s.memberships);
  const householdIds = useMemo(() => memberships.map((m) => m.household_id), [memberships]);
  const names = useMyHouseholds(householdIds);

  // `undefined` means "follow the canonical household", so the default keeps
  // tracking it while memberships hydrate instead of pinning an empty string.
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const householdId = resolveManagedHousehold(memberships, picked);
  const isOwner = memberships.find((m) => m.household_id === householdId)?.role === 'owner';

  const options = useMemo(
    () =>
      householdIds.map((id) => ({
        value: id,
        label: names.data?.find((h) => h.id === id)?.name ?? '…',
      })),
    [householdIds, names.data],
  );

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-2">{t('households.title')}</h1>
      <p className="text-ink-soft mb-6">{t('households.subtitle')}</p>
      {memberships.length > 1 && (
        <div className="mb-6">
          <label
            htmlFor="households-switcher"
            className="mb-1.5 block font-mono text-xs uppercase tracking-[0.18em] text-saffron"
          >
            {t('households.switcher_label')}
          </label>
          <Select
            id="households-switcher"
            options={options}
            value={householdId}
            onValueChange={setPicked}
            ariaLabel={t('households.switcher_label')}
          />
          <p className="mt-2 text-ink-soft text-xs">{t('households.switcher_help')}</p>
        </div>
      )}
      {householdId && <SharingSection householdId={householdId} isOwner={isOwner} />}
    </main>
  );
}
