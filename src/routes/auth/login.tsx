import { useFeatureFlag } from '@/feature-flags';
import { authErrorCopy } from '@/lib/auth-errors';
import { type LoginInput, LoginSchema } from '@/lib/forms/auth';
import { sanitizeNextPath } from '@/lib/safe-redirect';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

// `next` carries a signed-out visitor back to where they started (e.g. a
// /f/<code> follow link) after a successful sign-in. Validated loosely here —
// sanitizeNextPath is the actual gate, applied right before navigation — so an
// unsanitized value never lingers in the URL bar for the confirmed session.
const Search = z.object({ next: z.string().optional() });

export const Route = createFileRoute('/auth/login')({
  validateSearch: Search,
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { next } = Route.useSearch();
  const router = useRouter();
  const googleEnabled = useFeatureFlag('google_auth');
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-3xl mb-6">{t('auth.login')}</h1>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async (values) => {
            setServerError(null);
            const { error } = await supabase.auth.signInWithPassword(values);
            if (error) {
              setServerError(authErrorCopy(error.message));
              return;
            }
            router.history.push(sanitizeNextPath(next));
          })}
        >
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.email')}</span>
            <Input
              type="email"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="login-email-error" role="alert" className="text-pomegranate text-sm">
                {errors.email.message}
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.password')}</span>
            <Input
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <p id="login-password-error" role="alert" className="text-pomegranate text-sm">
                {errors.password.message}
              </p>
            )}
          </label>
          {serverError && (
            <p role="alert" aria-live="assertive" className="text-pomegranate text-sm">
              {serverError}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {t('auth.submit_login')}
          </Button>
        </form>
        {googleEnabled && (
          <Button
            variant="ghost"
            className="w-full mt-3"
            onClick={() =>
              supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${location.origin}/auth/callback` },
              })
            }
          >
            {t('auth.google')}
          </Button>
        )}
        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/auth/reset" className="underline">
            {t('auth.forgot')}
          </Link>
          <span className="mx-2">·</span>
          <Link to="/auth/signup" search={{ next }} className="underline">
            {t('auth.signup')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
