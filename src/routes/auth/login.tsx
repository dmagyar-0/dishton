import { useFeatureFlag } from '@/feature-flags';
import { authErrorCopy } from '@/lib/auth-errors';
import { type LoginInput, LoginSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/auth/login')({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
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
            await nav({ to: '/' });
          })}
        >
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.email')}</span>
            <Input type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-pomegranate text-sm">{errors.email.message}</p>}
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.password')}</span>
            <Input type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && (
              <p className="text-pomegranate text-sm">{errors.password.message}</p>
            )}
          </label>
          {serverError && <p className="text-pomegranate text-sm">{serverError}</p>}
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
          <Link to="/auth/signup" className="underline">
            {t('auth.signup')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
