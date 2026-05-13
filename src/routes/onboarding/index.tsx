import { refreshAuthDerivedState, useAuth } from '@/lib/auth';
import {
  type CreateHouseholdInput,
  CreateHouseholdSchema,
  type RedeemInviteInput,
  RedeemInviteSchema,
} from '@/lib/forms/household';
import { supabase } from '@/lib/supabase';
import { translateHouseholdError } from '@/ui/household/translateError';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../_guards';

export const Route = createFileRoute('/onboarding/')({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): { code?: string } => {
    const raw = typeof search.code === 'string' ? search.code : undefined;
    if (!raw) return {};
    return /^[A-Z2-7]{8}$/.test(raw) ? { code: raw } : {};
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t } = useTranslation();
  const { code: prefilledCode } = Route.useSearch();
  const nav = useNavigate();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const create = useForm<CreateHouseholdInput>({ resolver: zodResolver(CreateHouseholdSchema) });
  const redeem = useForm<RedeemInviteInput>({
    resolver: zodResolver(RedeemInviteSchema),
    defaultValues: prefilledCode ? { code: prefilledCode } : undefined,
  });

  useEffect(() => {
    if (prefilledCode) {
      redeem.setValue('code', prefilledCode, { shouldValidate: true });
    }
  }, [prefilledCode, redeem]);

  return (
    <main className="min-h-dvh px-4 py-12 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      <Card className="p-6">
        <h2 className="font-display text-2xl mb-4">{t('household.create_title')}</h2>
        <form
          className="space-y-3"
          onSubmit={create.handleSubmit(async (values) => {
            if (!auth.user) return;
            setServerError(null);
            const { data: hh, error } = await supabase
              .from('households')
              .insert({ name: values.name, owner_profile_id: auth.user.id })
              .select('id')
              .single();
            if (error || !hh) {
              setServerError(error?.message ?? 'failed');
              return;
            }
            await supabase.from('household_members').insert({
              household_id: hh.id,
              profile_id: auth.user.id,
              role: 'owner',
            });
            auth.setMemberships([{ household_id: hh.id as string, role: 'owner' }]);
            await nav({ to: '/h/$householdId', params: { householdId: hh.id as string } });
          })}
        >
          <Input placeholder="The Pantry" {...create.register('name')} />
          {create.formState.errors.name && (
            <p className="text-pomegranate text-sm">{create.formState.errors.name.message}</p>
          )}
          <Button type="submit" className="w-full" disabled={create.formState.isSubmitting}>
            {t('household.create')}
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="font-display text-2xl mb-4">{t('household.redeem_title')}</h2>
        {prefilledCode && (
          <p className="text-sage-ink bg-sage/30 rounded-[var(--radius-md)] px-3 py-2 text-sm mb-3">
            {t('household.invite_prefilled')}
          </p>
        )}
        <form
          className="space-y-3"
          onSubmit={redeem.handleSubmit(async (values) => {
            if (!auth.user) return;
            setServerError(null);
            const { data, error } = await supabase.rpc('redeem_invite', { p_code: values.code });
            if (error) {
              setServerError(translateHouseholdError(t, error));
              return;
            }
            const householdId = data as unknown as string;
            // Refresh from the server so role is authoritative rather than guessed.
            await refreshAuthDerivedState(auth.user.id);
            await nav({ to: '/h/$householdId', params: { householdId } });
          })}
        >
          <Input
            placeholder={t('household.invite_placeholder')}
            autoFocus={!!prefilledCode}
            {...redeem.register('code')}
          />
          {redeem.formState.errors.code && (
            <p className="text-pomegranate text-sm">{redeem.formState.errors.code.message}</p>
          )}
          <Button type="submit" variant="secondary" className="w-full">
            {t('household.redeem')}
          </Button>
        </form>
      </Card>

      {serverError && <p className="md:col-span-2 text-pomegranate text-sm">{serverError}</p>}
    </main>
  );
}
