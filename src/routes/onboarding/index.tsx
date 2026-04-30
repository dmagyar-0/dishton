import { useAuth } from '@/lib/auth';
import {
  type CreateHouseholdInput,
  CreateHouseholdSchema,
  type RedeemInviteInput,
  RedeemInviteSchema,
} from '@/lib/forms/household';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../_guards';

export const Route = createFileRoute('/onboarding/')({
  beforeLoad: requireAuth,
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const create = useForm<CreateHouseholdInput>({ resolver: zodResolver(CreateHouseholdSchema) });
  const redeem = useForm<RedeemInviteInput>({ resolver: zodResolver(RedeemInviteSchema) });

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
        <form
          className="space-y-3"
          onSubmit={redeem.handleSubmit(async (values) => {
            setServerError(null);
            const { data, error } = await supabase.rpc('redeem_invite', { p_code: values.code });
            if (error) {
              setServerError(error.message);
              return;
            }
            const householdId = data as unknown as string;
            auth.setMemberships([
              ...auth.memberships,
              { household_id: householdId, role: 'editor' },
            ]);
            await nav({ to: '/h/$householdId', params: { householdId } });
          })}
        >
          <Input placeholder={t('household.invite_placeholder')} {...redeem.register('code')} />
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
