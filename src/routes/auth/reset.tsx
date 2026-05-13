import { type ResetInput, ResetSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/auth/reset')({
  component: ResetPage,
});

function ResetPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(ResetSchema) });

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-3xl mb-6">{t('auth.forgot')}</h1>
        {sent ? (
          <p>Check your email for a reset link.</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={handleSubmit(async (values) => {
              await supabase.auth.resetPasswordForEmail(values.email, {
                redirectTo: `${location.origin}/auth/update-password`,
              });
              setSent(true);
            })}
          >
            <label className="block">
              <span className="text-sm text-ink-soft">{t('auth.email')}</span>
              <Input type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-pomegranate text-sm">{errors.email.message}</p>}
            </label>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              Send reset link
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
