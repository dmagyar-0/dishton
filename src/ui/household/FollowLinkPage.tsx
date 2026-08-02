// Public, unauthenticated follow-link landing page body. The /f/$code route
// wires the URL param into this prop; keeping the component router-light
// makes it testable without router internals. The code in the URL is the
// credential, resolved via the peek_follow_code RPC (anon-capable).

import { useAuth } from '@/lib/auth';
import { pickCanonicalHousehold } from '@/lib/canonical-household';
import { followLinkPath } from '@/lib/follow-link';
import { useAddFollow, useFollowedHouseholds, usePeekFollowCode } from '@/lib/queries/households';
import { Button, Card, Skeleton, useToast } from '@/ui/primitives';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { translateHouseholdError } from './translateError';

export type FollowLinkPageProps = { code: string };

const CTA_CLASS =
  'inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-saffron px-5 font-body text-sm text-saffron-ink shadow-press transition-colors duration-[var(--duration-fast)] hover:opacity-90';

const SECONDARY_CLASS =
  'inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-cream-line px-5 font-body text-sm text-ink transition-colors duration-[var(--duration-fast)] hover:bg-paper-2';

export function FollowLinkPage({ code }: FollowLinkPageProps) {
  const { t } = useTranslation();
  const { push } = useToast();
  const nav = useNavigate();

  const peek = usePeekFollowCode(code);
  const hydrated = useAuth((s) => s.hydrated);
  const session = useAuth((s) => s.session);
  const memberships = useAuth((s) => s.memberships);
  const canonical = useMemo(() => pickCanonicalHousehold(memberships), [memberships]);

  const followed = useFollowedHouseholds(canonical?.household_id ?? '', !!canonical);
  const addFollow = useAddFollow(canonical?.household_id ?? '');

  useEffect(() => {
    if (peek.data) document.title = `${peek.data.household_name} — ${t('app.name')}`;
  }, [peek.data, t]);

  const showSkeleton = !hydrated || peek.isLoading || (!!canonical && followed.isLoading);

  if (showSkeleton) {
    return (
      <Frame>
        <Skeleton className="h-40" />
      </Frame>
    );
  }

  if (!peek.data) {
    return (
      <Frame>
        <Card className="space-y-3 p-6 text-center">
          <h1 className="font-display text-2xl text-ink">{t('follow_link.invalid_title')}</h1>
          <p className="text-ink-soft">{t('follow_link.invalid_body')}</p>
          <div className="pt-2">
            <Link to="/" className={CTA_CLASS}>
              {t('follow_link.invalid_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  const { household_id: followedId, household_name: name } = peek.data;

  if (!session) {
    return (
      <Frame>
        <Card className="space-y-4 p-6 text-center">
          <h1 className="font-display text-2xl text-ink">{t('follow_link.heading', { name })}</h1>
          <p className="text-ink-soft">{t('follow_link.body')}</p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
            <Link to="/auth/signup" search={{ next: followLinkPath(code) }} className={CTA_CLASS}>
              {t('follow_link.signup_action')}
            </Link>
            <Link
              to="/auth/login"
              search={{ next: followLinkPath(code) }}
              className={SECONDARY_CLASS}
            >
              {t('follow_link.login_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  if (canonical && canonical.household_id === followedId) {
    return (
      <Frame>
        <Card className="space-y-3 p-6 text-center">
          <h1 className="font-display text-2xl text-ink">{t('follow_link.own_title')}</h1>
          <p className="text-ink-soft">{t('follow_link.own_body')}</p>
          <div className="pt-2">
            <Link to="/" className={CTA_CLASS}>
              {t('follow_link.own_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  const alreadyFollowing =
    followed.data?.some((f) => f.followed_household_id === followedId) ?? false;

  if (alreadyFollowing) {
    return (
      <Frame>
        <Card className="space-y-3 p-6 text-center">
          <h1 className="font-display text-2xl text-ink">
            {t('follow_link.already_title', { name })}
          </h1>
          <div className="pt-2">
            <Link to="/h/$householdId" params={{ householdId: followedId }} className={CTA_CLASS}>
              {t('follow_link.already_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  // Every signed-in profile gets a personal household at signup, so this is
  // only reachable for a session mid-hydration edge case — but add_follow
  // requires an owned household, so there is nothing useful to offer here.
  if (!canonical) {
    return (
      <Frame>
        <Card className="space-y-3 p-6 text-center">
          <p className="text-ink-soft">{t('household_errors.no_owned_household')}</p>
          <div className="pt-2">
            <Link to="/" className={CTA_CLASS}>
              {t('follow_link.invalid_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  const onFollow = async () => {
    try {
      const followedHouseholdId = await addFollow.mutateAsync(code);
      push({ variant: 'success', title: t('following.add_success', { name }) });
      await nav({ to: '/h/$householdId', params: { householdId: followedHouseholdId } });
    } catch (err) {
      push({
        variant: 'error',
        title: t('following.add_failed'),
        description: translateHouseholdError(t, err),
      });
    }
  };

  return (
    <Frame>
      <Card className="space-y-4 p-6 text-center">
        <h1 className="font-display text-2xl text-ink">{t('follow_link.heading', { name })}</h1>
        <p className="text-ink-soft">{t('follow_link.body')}</p>
        <div className="pt-2">
          <Button onClick={() => void onFollow()} loading={addFollow.isPending}>
            {t('follow_link.follow_action')}
          </Button>
        </div>
      </Card>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-cream-line">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <Link to="/" className="font-display text-xl text-aubergine">
            {t('app.name')}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-12">{children}</main>
    </div>
  );
}
