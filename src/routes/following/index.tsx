import { useFeatureFlagStatus } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { type AddFollowInput, AddFollowSchema } from '@/lib/forms/household';
import { useAddFollow, useFollowedHouseholds, useUnfollow } from '@/lib/queries/households';
import { ConfirmDialog } from '@/ui/household/dialogs/ConfirmDialog';
import { translateHouseholdError } from '@/ui/household/translateError';
import { Button, Card, EmptyState, Skeleton, useToast } from '@/ui/primitives';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../_guards';

export const Route = createFileRoute('/following/')({
  beforeLoad: requireAuth,
  component: FollowingGate,
});

// FLAG: follows_enabled — the /following surface only exists when following is
// turned on (off by default in MVP production per docs/15). We gate at render
// rather than in beforeLoad because the runtime flag is fetched client-side.
// On a cold load the flag value isn't known yet, so we wait for it to resolve
// before deciding: redirecting on the transient default-off value throws a
// redirect mid-render and trips the error boundary. Once resolved, a flag-off
// user is redirected home. Exported for the colocated flag-gating test.
export function FollowingGate() {
  const { enabled, isResolved } = useFeatureFlagStatus('follows_enabled');
  if (!isResolved) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Skeleton className="h-40" />
      </main>
    );
  }
  if (!enabled) {
    throw redirect({ to: '/' });
  }
  return <FollowingPage />;
}

function FollowingPage() {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const memberships = useAuth((s) => s.memberships);
  // Canonical household for following: prefer the personal household so the
  // list read here, the add_follow target, and AppShell all agree on a single
  // household. A newly added follow then appears exactly where the user looks.
  const currentHouseholdId = useMemo(
    () => (memberships.find((m) => m.is_personal) ?? memberships[0])?.household_id ?? '',
    [memberships],
  );

  const followed = useFollowedHouseholds(currentHouseholdId);
  const addFollow = useAddFollow(currentHouseholdId);
  const unfollow = useUnfollow(currentHouseholdId);
  const form = useForm<AddFollowInput>({ resolver: zodResolver(AddFollowSchema) });
  const [pendingUnfollow, setPendingUnfollow] = useState<{ id: string; name: string } | null>(null);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
      }),
    [i18n.language],
  );

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="font-display text-3xl">{t('following.title')}</h1>

      <Card className="p-6 space-y-3">
        <div>
          <h2 className="font-display text-xl mb-1">{t('following.add_title')}</h2>
          <p className="text-ink-soft text-sm">{t('following.add_help')}</p>
        </div>
        <form
          className="flex gap-2 items-start"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              const followedId = await addFollow.mutateAsync(values.code);
              form.reset({ code: '' });
              // The RPC returns the followed household id; the followed list has
              // just been invalidated, so refetch it and surface the household
              // name when available. Fall back to a name-less message otherwise.
              const refreshed = await followed.refetch();
              const match = refreshed.data?.find((f) => f.followed_household_id === followedId);
              push({
                variant: 'success',
                title: match
                  ? t('following.add_success', { name: match.household.name })
                  : t('following.add_success_generic'),
              });
            } catch (err) {
              push({
                variant: 'error',
                title: t('following.add_failed'),
                description: translateHouseholdError(t, err),
              });
            }
          })}
        >
          <div className="flex-1">
            <Input
              placeholder={t('following.add_placeholder')}
              autoComplete="off"
              {...form.register('code')}
            />
            {form.formState.errors.code && (
              <p className="text-pomegranate text-sm mt-1">{form.formState.errors.code.message}</p>
            )}
          </div>
          <Button
            type="submit"
            variant="secondary"
            loading={addFollow.isPending}
            disabled={addFollow.isPending}
          >
            {t('following.add_action')}
          </Button>
        </form>
      </Card>

      {followed.isLoading && (
        <Card className="p-6">
          <Skeleton className="h-16" />
        </Card>
      )}

      {followed.data && followed.data.length === 0 && (
        <Card className="p-6">
          <EmptyState
            title={t('following.empty_title')}
            description={t('following.empty_body')}
            action={null}
          />
        </Card>
      )}

      {followed.data && followed.data.length > 0 && (
        <Card className="p-2">
          <ul className="divide-y divide-cream-line">
            {followed.data.map((f) => (
              <li
                key={f.followed_household_id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-body text-ink">{f.household.name}</p>
                  <p className="text-ink-soft text-xs">
                    {t('following.followed_at', {
                      date: dateFormatter.format(new Date(f.created_at)),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    to="/h/$householdId"
                    params={{ householdId: f.followed_household_id }}
                    className="text-saffron hover:underline font-body text-sm"
                  >
                    {t('following.open')}
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={unfollow.isPending}
                    onClick={() =>
                      setPendingUnfollow({
                        id: f.followed_household_id,
                        name: f.household.name,
                      })
                    }
                  >
                    {t('following.unfollow')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={pendingUnfollow !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUnfollow(null);
        }}
        title={t('following.unfollow_confirm_title', { name: pendingUnfollow?.name ?? '' })}
        body={t('following.unfollow_confirm_body')}
        confirmLabel={t('following.unfollow_action')}
        variant="destructive"
        loading={unfollow.isPending}
        onConfirm={async () => {
          if (!pendingUnfollow) return;
          try {
            await unfollow.mutateAsync(pendingUnfollow.id);
            push({ variant: 'success', title: t('following.unfollow_success') });
            setPendingUnfollow(null);
          } catch (err) {
            push({
              variant: 'error',
              title: t('following.unfollow_failed'),
              description: translateHouseholdError(t, err),
            });
          }
        }}
      />
    </main>
  );
}
