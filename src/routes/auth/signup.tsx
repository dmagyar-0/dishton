import { authErrorCopy } from '@/lib/auth-errors';
import { type SignupInput, SignupSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/auth/signup')({
  component: SignupPage,
});

function SignupPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(SignupSchema) });

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-3xl mb-6">{t('auth.signup')}</h1>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async (values) => {
            setServerError(null);
            const { error } = await supabase.auth.signUp({
              email: values.email,
              password: values.password,
              options: { data: { display_name: values.display_name } },
            });
            if (error) {
              setServerError(authErrorCopy(error.message));
              return;
            }
            await nav({ to: '/onboarding' });
          })}
        >
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.display_name')}</span>
            <Input {...register('display_name')} />
            {errors.display_name && (
              <p className="text-pomegranate text-sm">{errors.display_name.message}</p>
            )}
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.email')}</span>
            <Input type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-pomegranate text-sm">{errors.email.message}</p>}
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t('auth.password')}</span>
            <Input type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && (
              <p className="text-pomegranate text-sm">{errors.password.message}</p>
            )}
          </label>
          {serverError && <p className="text-pomegranate text-sm">{serverError}</p>}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {t('auth.submit_signup')}
          </Button>
        </form>
        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/auth/login" className="underline">
            {t('auth.login')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
