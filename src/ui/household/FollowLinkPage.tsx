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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translateHouseholdError } from './translateError';

export type FollowLinkPageProps = { code: string };

const CTA_CLASS =
  'inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-saffron px-5 font-body text-sm text-saffron-ink shadow-press transition-colors duration-[var(--duration-fast)] hover:opacity-90';

const SECONDARY_CLASS =
  'inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-cream-line px-5 font-body text-sm text-ink transition-colors duration-[var(--duration-fast)] hover:bg-paper-2';

// sessionStorage key recording "this tab pressed Sign up/Log in to follow
// <code>". Set the instant that action is taken (below), read once — and
// cleared unconditionally at the same time — on the return trip through
// FollowLinkPage so the follow completes without a second click.
//
// Why sessionStorage and not a `?auto=1` URL param carried through `next`: a
// URL param would let a crafted `/f/<code>?auto=1` link silently follow a
// household for anyone who merely opens it while already signed in — no
// confirming click required. The sessionStorage key only exists if this same
// person, in this same tab, pressed "Sign up to follow" or "Log in" moments
// earlier, so it captures real intent and can't be forged by a link.
// `enable_confirmations = false` in supabase/config.toml, so signup mints a
// session in the same tab and the key survives the round trip; if
// confirmation is ever enabled and the visitor confirms from a different tab,
// the key just won't be there and this degrades to today's manual Follow
// button — acceptable and intended.
const FOLLOW_INTENT_KEY = 'dishton.follow_intent';

function recordFollowIntent(code: string): void {
  try {
    sessionStorage.setItem(FOLLOW_INTENT_KEY, code);
  } catch {
    /* private mode / storage disabled — the link still works, just without auto-follow */
  }
}

function hasFollowIntent(code: string): boolean {
  try {
    return sessionStorage.getItem(FOLLOW_INTENT_KEY) === code;
  } catch {
    return false;
  }
}

function clearFollowIntent(): void {
  try {
    sessionStorage.removeItem(FOLLOW_INTENT_KEY);
  } catch {
    /* ignore */
  }
}

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

  // "Peek" because these mirror peek.data before the null-check below narrows
  // it — needed early since the auto-follow eligibility hooks below must be
  // called unconditionally, ahead of any early return.
  const followedIdPeek = peek.data?.household_id;
  const isOwnHousehold =
    !!canonical && !!followedIdPeek && canonical.household_id === followedIdPeek;
  const alreadyFollowing =
    followed.data?.some((f) => f.followed_household_id === followedIdPeek) ?? false;

  // Eligible for auto-follow once we know enough to act: signed in, have a
  // follower household, know what the code resolves to, and it isn't one of
  // the states that must still short-circuit even with a matching intent.
  const canAutoFollow =
    !!session && !!canonical && !!followedIdPeek && !isOwnHousehold && !alreadyFollowing;

  const [autoFollowStatus, setAutoFollowStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  // Guards against firing twice: React (StrictMode) double-invokes effects in
  // dev, and clearFollowIntent() alone can't be the only guard because the
  // mutation below is async — the effect could in principle run again before
  // it settles.
  const autoFollowStarted = useRef(false);

  // Defined ahead of the early returns (alongside the hooks above) so the
  // auto-follow layout effect can call it. Reads `peek.data` fresh rather
  // than closing over the narrowed `name`/`followedId` declared further down
  // — those aren't reachable on every render (e.g. an early return before
  // they're assigned), whereas `peek.data` itself always is.
  const onFollow = async () => {
    try {
      const followedHouseholdId = await addFollow.mutateAsync(code);
      push({
        variant: 'success',
        title: t('following.add_success', { name: peek.data?.household_name ?? '' }),
      });
      await nav({ to: '/h/$householdId', params: { householdId: followedHouseholdId } });
    } catch (err) {
      push({
        variant: 'error',
        title: t('following.add_failed'),
        description: translateHouseholdError(t, err),
      });
      // Meaningful only for the auto-follow path — a manual click that fails
      // leaves this in an unused 'error' state, which changes nothing about
      // the manual button below. The intent key is already cleared by the
      // time this runs, so there's nothing left to retry automatically; the
      // manual Follow button rendered below (with the error already
      // surfaced above) is the correct and only safe recovery.
      setAutoFollowStatus('error');
    }
  };

  // useLayoutEffect, not useEffect: it runs synchronously before the browser
  // paints, so the flip to 'pending' lands in the same commit as the render
  // that discovers auto-follow is eligible — the visitor never sees the
  // "Follow <Household>?" prompt card, even for a single frame, before the
  // pending state replaces it. See CLAUDE.md on flash-of-wrong-content bugs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onFollow is re-created every render; the ref guard below (not this dep array) is what makes this fire exactly once per eligible mount, so adding it would only cause needless re-triggers of this check.
  useLayoutEffect(() => {
    if (!canAutoFollow || autoFollowStarted.current) return;
    if (!hasFollowIntent(code)) return;
    // Clear immediately, before awaiting anything: once this fires, the
    // intent can never re-fire or trap the visitor in a follow loop, even if
    // the mutation below fails.
    clearFollowIntent();
    autoFollowStarted.current = true;
    setAutoFollowStatus('pending');
    void onFollow();
  }, [canAutoFollow, code]);

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
            {/* Record intent before leaving for auth — see FOLLOW_INTENT_KEY
                above for why this (and not a URL param) is what lets the
                follow complete automatically on return. */}
            <Link
              to="/auth/signup"
              search={{ next: followLinkPath(code) }}
              className={CTA_CLASS}
              onClick={() => recordFollowIntent(code)}
            >
              {t('follow_link.signup_action')}
            </Link>
            <Link
              to="/auth/login"
              search={{ next: followLinkPath(code) }}
              className={SECONDARY_CLASS}
              onClick={() => recordFollowIntent(code)}
            >
              {t('follow_link.login_action')}
            </Link>
          </div>
        </Card>
      </Frame>
    );
  }

  if (isOwnHousehold) {
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

  return (
    <Frame>
      <Card className="space-y-4 p-6 text-center">
        <h1 className="font-display text-2xl text-ink">{t('follow_link.heading', { name })}</h1>
        <p className="text-ink-soft">{t('follow_link.body')}</p>
        <div className="pt-2">
          {/* addFollow.isPending covers a manual click; autoFollowStatus
              covers the auto-follow-after-auth run kicked off above, which
              starts (and shows this same loading treatment) before the
              visitor ever sees an idle, clickable button. */}
          <Button
            onClick={() => void onFollow()}
            loading={addFollow.isPending || autoFollowStatus === 'pending'}
          >
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
