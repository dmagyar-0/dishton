import { useAuth } from '@/lib/auth';
import { useHousehold, useHouseholdMembers } from '@/lib/queries/households';
import { setHouseholdContext } from '@/observability/sentry';
import { GeneralSection } from '@/ui/household/GeneralSection';
import { MembersSection } from '@/ui/household/MembersSection';
import { SharingSection } from '@/ui/household/SharingSection';
import { TagsSection } from '@/ui/household/TagsSection';
import { Button, Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

type SettingsTab = 'general' | 'members' | 'sharing' | 'tags';

const TAB_VALUES: ReadonlyArray<SettingsTab> = ['general', 'members', 'sharing', 'tags'];

export const Route = createFileRoute('/h/$householdId/settings')({
  beforeLoad: requireAuth,
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
  const isMember = memberships.some((m) => m.household_id === householdId);
  const isOwner = memberships.some((m) => m.household_id === householdId && m.role === 'owner');

  const household = useHousehold(householdId);
  const members = useHouseholdMembers(householdId);
  // Solo = personal household with only the current user as a member.
  // We hide the household name editor, the danger zone, and the members
  // list in this mode and show a single "Invite to share" CTA instead.
  const isSolo = household.data?.is_personal === true && (members.data?.length ?? 0) <= 1;

  // Tag the current household for observability while the user manages it.
  useEffect(() => {
    setHouseholdContext(householdId);
  }, [householdId]);

  // A non-member who deep-links here gets RLS-empty data and would otherwise
  // see a blank shell. Show an explicit no-access message instead.
  if (!isMember) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="font-display text-2xl">{t('household_settings.no_access_title')}</h1>
          <p className="text-ink-soft leading-relaxed">{t('household_settings.no_access_body')}</p>
          <Button onClick={() => void nav({ to: '/' })}>{t('household_settings.go_home')}</Button>
        </Card>
      </main>
    );
  }

  // The data load genuinely failed (network/5xx) rather than returning empty.
  if (household.isError || members.isError) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="font-display text-2xl">{t('household_settings.load_error_title')}</h1>
          <p className="text-ink-soft leading-relaxed">{t('household_settings.load_error_body')}</p>
          <Button
            onClick={() => {
              void household.refetch();
              void members.refetch();
            }}
          >
            {t('household_settings.load_error_retry')}
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-2">
        {isSolo ? t('household_settings.solo.title') : t('household_settings.title')}
      </h1>
      <p className="text-ink-soft mb-6">
        {isSolo ? t('household_settings.solo.subtitle') : t('household_settings.subtitle')}
      </p>

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
          <TabsTrigger value="members">
            {isSolo ? t('household_settings.tabs.invite') : t('household_settings.tabs.members')}
          </TabsTrigger>
          <TabsTrigger value="sharing">{t('household_settings.tabs.sharing')}</TabsTrigger>
          <TabsTrigger value="tags">{t('household_settings.tabs.tags')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSection
            household={household.data}
            householdId={householdId}
            isLoading={household.isLoading}
            isOwner={isOwner}
            isSolo={isSolo}
          />
        </TabsContent>

        <TabsContent value="members">
          {user && (
            <MembersSection
              householdId={householdId}
              selfProfileId={user.id}
              isOwner={isOwner}
              isSolo={isSolo}
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
