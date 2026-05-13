import { useAuth } from '@/lib/auth';
import { useHousehold } from '@/lib/queries/households';
import { GeneralSection } from '@/ui/household/GeneralSection';
import { MembersSection } from '@/ui/household/MembersSection';
import { SharingSection } from '@/ui/household/SharingSection';
import { TagsSection } from '@/ui/household/TagsSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../../_guards';

type SettingsTab = 'general' | 'members' | 'sharing' | 'tags';

const TAB_VALUES: ReadonlyArray<SettingsTab> = ['general', 'members', 'sharing', 'tags'];

export const Route = createFileRoute('/h/$householdId/settings')({
  beforeLoad: requireHousehold,
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => {
    const raw = typeof search.tab === 'string' ? search.tab : '';
    const tab = (TAB_VALUES as readonly string[]).includes(raw) ? (raw as SettingsTab) : 'general';
    return { tab };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { householdId } = Route.useParams();
  const { tab } = Route.useSearch();
  const nav = useNavigate({ from: '/h/$householdId/settings' });
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const memberships = useAuth((s) => s.memberships);
  const isOwner = memberships.some((m) => m.household_id === householdId && m.role === 'owner');

  const household = useHousehold(householdId);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-2">{t('household_settings.title')}</h1>
      <p className="text-ink-soft mb-6">{t('household_settings.subtitle')}</p>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if ((TAB_VALUES as readonly string[]).includes(value)) {
            void nav({
              search: { tab: value as SettingsTab },
              replace: true,
            });
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="general">{t('household_settings.tabs.general')}</TabsTrigger>
          <TabsTrigger value="members">{t('household_settings.tabs.members')}</TabsTrigger>
          <TabsTrigger value="sharing">{t('household_settings.tabs.sharing')}</TabsTrigger>
          <TabsTrigger value="tags">{t('household_settings.tabs.tags')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSection
            household={household.data}
            householdId={householdId}
            isLoading={household.isLoading}
            isOwner={isOwner}
          />
        </TabsContent>

        <TabsContent value="members">
          {user && (
            <MembersSection
              householdId={householdId}
              selfProfileId={user.id}
              isOwner={isOwner}
              onRequestDeleteHousehold={() => {
                void nav({ search: { tab: 'general' }, replace: true });
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="sharing">
          <SharingSection householdId={householdId} isOwner={isOwner} />
        </TabsContent>

        <TabsContent value="tags">
          <TagsSection
            household={household.data}
            householdId={householdId}
            isLoading={household.isLoading}
            isOwner={isOwner}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
