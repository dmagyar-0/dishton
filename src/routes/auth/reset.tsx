import { type ResetInput, ResetSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { AuthWordmark } from '@/ui/auth/AuthWordmark';
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

// Supabase intentionally does not reveal whether an email exists: a
// "user not found" still resolves without an error. A real error from
// resetPasswordForEmail therefore means a transport/server failure (network,
// 429, 5xx), which the user can retry. We keep the enumeration-resistant
// "if an account exists…" copy for the success case.
function isTransportError(status: number | undefined): boolean {
  if (status === undefined) return true; // network failure: no HTTP status
  return status === 429 || status >= 500;
}

function ResetPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(ResetSchema) });

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <AuthWordmark />
        <h1 className="font-display text-3xl mb-6">{t('auth.forgot')}</h1>
        {sent ? (
          <p role="status">{t('auth.reset.sent')}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={handleSubmit(async (values) => {
              setServerError(null);
              const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
                redirectTo: `${location.origin}/auth/update-password`,
              });
              if (error && isTransportError(error.status)) {
                setServerError(t('auth.reset.retry'));
                return;
              }
              setSent(true);
            })}
          >
            <label className="block">
              <span className="text-sm text-ink-soft">{t('auth.email')}</span>
              <Input
                type="email"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'reset-email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="reset-email-error" role="alert" className="text-pomegranate text-sm">
                  {errors.email.message}
                </p>
              )}
            </label>
            {serverError && (
              <p role="alert" aria-live="assertive" className="text-pomegranate text-sm">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {t('auth.reset.submit')}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
