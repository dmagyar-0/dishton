import { useAuth } from '@/lib/auth';
import { type AddFollowInput, AddFollowSchema } from '@/lib/forms/household';
import { useAddFollow, useFollowedHouseholds } from '@/lib/queries/households';
import { translateHouseholdError } from '@/ui/household/translateError';
import { Button, Card, EmptyState, Skeleton, useToast } from '@/ui/primitives';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../_guards';

export const Route = createFileRoute('/following/')({
  beforeLoad: requireAuth,
  component: FollowingPage,
});

function FollowingPage() {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const memberships = useAuth((s) => s.memberships);
  const currentHouseholdId = memberships[0]?.household_id ?? '';

  const followed = useFollowedHouseholds(currentHouseholdId);
  const addFollow = useAddFollow(currentHouseholdId);
  const form = useForm<AddFollowInput>({ resolver: zodResolver(AddFollowSchema) });

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
              await addFollow.mutateAsync(values.code);
              form.reset({ code: '' });
              push({
                variant: 'success',
                title: t('following.add_success', { name: '' }),
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
                <Link
                  to="/h/$householdId"
                  params={{ householdId: f.followed_household_id }}
                  className="text-saffron hover:underline font-body text-sm"
                >
                  {t('following.open')}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
