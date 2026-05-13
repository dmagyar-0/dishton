import { authErrorCopy } from '@/lib/auth-errors';
import { type UpdatePasswordInput, UpdatePasswordSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/auth/update-password')({
  component: UpdatePasswordPage,
});

// Status of the recovery session the Supabase client builds from the URL
// fragment (`#access_token=...&type=recovery`). The Supabase JS client emits
// `PASSWORD_RECOVERY` once it detects the recovery hash; we wait for that
// before allowing the form to submit, so a stale logged-in session can't be
// used to silently change the password.
type RecoveryStatus = 'pending' | 'ready' | 'missing';

function UpdatePasswordPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [recovery, setRecovery] = useState<RecoveryStatus>('pending');
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery('ready');
      } else if (event === 'SIGNED_IN' && session) {
        setRecovery((prev) => (prev === 'pending' ? 'ready' : prev));
      }
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      // Hash containing a recovery token may still be processing; if the
      // session is already populated we let the user proceed. The
      // PASSWORD_RECOVERY event above promotes us from 'pending' otherwise.
      if (data.session) {
        setRecovery((prev) => (prev === 'pending' ? 'ready' : prev));
      } else {
        // Give detectSessionInUrl a beat to run before declaring failure.
        setTimeout(() => {
          if (!cancelled) {
            setRecovery((prev) => (prev === 'pending' ? 'missing' : prev));
          }
        }, 1500);
      }
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdatePasswordInput>({ resolver: zodResolver(UpdatePasswordSchema) });

  if (recovery === 'missing') {
    return (
      <main className="min-h-dvh flex items-center justify-center px-4">
        <Card className="w-full max-w-md p-8 space-y-4">
          <h1 className="font-display text-3xl">{t('auth.update_password.title')}</h1>
          <p className="text-ink-soft text-sm">{t('auth.update_password.expired')}</p>
          <Link to="/auth/reset" className="underline text-sm">
            {t('auth.update_password.request_new')}
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-3xl mb-6">{t('auth.update_password.title')}</h1>
        {done ? (
          <div className="space-y-4">
            <p>{t('auth.update_password.success')}</p>
            <Button onClick={() => nav({ to: '/' })} className="w-full">
              {t('auth.update_password.continue')}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={handleSubmit(async (values) => {
              setServerError(null);
              const { error } = await supabase.auth.updateUser({ password: values.password });
              if (error) {
                setServerError(authErrorCopy(error.message));
                return;
              }
              setDone(true);
            })}
          >
            <label className="block">
              <span className="text-sm text-ink-soft">
                {t('auth.update_password.new_password')}
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={recovery !== 'ready'}
                {...register('password')}
              />
              {errors.password && (
                <p className="text-pomegranate text-sm">{errors.password.message}</p>
              )}
            </label>
            <label className="block">
              <span className="text-sm text-ink-soft">{t('auth.update_password.confirm')}</span>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={recovery !== 'ready'}
                {...register('confirm')}
              />
              {errors.confirm && (
                <p className="text-pomegranate text-sm">{errors.confirm.message}</p>
              )}
            </label>
            {serverError && <p className="text-pomegranate text-sm">{serverError}</p>}
            <Button
              type="submit"
              disabled={isSubmitting || recovery !== 'ready'}
              className="w-full"
            >
              {recovery === 'ready'
                ? t('auth.update_password.submit')
                : t('auth.update_password.preparing')}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
