import { authErrorCopy } from '@/lib/auth-errors';
import { type UpdatePasswordInput, UpdatePasswordSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { AuthWordmark } from '@/ui/auth/AuthWordmark';
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
//
// `pending` -> we're still waiting for the client to process the URL hash.
// `ready`   -> recovery session established; the form is usable.
// We deliberately do NOT hard-fail to a "link expired" dead-end on a fixed
// timer: on a slow connection detectSessionInUrl can take several seconds, and
// declaring a valid link "expired" is the worse error. Instead, after a grace
// period we surface a non-destructive "having trouble?" affordance while the
// PASSWORD_RECOVERY event can still promote us to `ready` at any moment.
type RecoveryStatus = 'pending' | 'ready';

// Show the "having trouble?" help once the recovery hash has clearly failed to
// resolve. Generous so slow connections aren't told a good link is broken.
const TROUBLE_GRACE_MS = 8000;

function UpdatePasswordPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [recovery, setRecovery] = useState<RecoveryStatus>('pending');
  const [showTrouble, setShowTrouble] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery('ready');
        setShowTrouble(false);
      } else if (event === 'SIGNED_IN' && session) {
        setRecovery((prev) => (prev === 'pending' ? 'ready' : prev));
        setShowTrouble(false);
      }
    });

    // Poll getSession with backoff while pending: detectSessionInUrl may not
    // have finished by first render, especially on slow connections.
    const delays = [200, 500, 1000, 2000, 4000];
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setRecovery((prev) => (prev === 'pending' ? 'ready' : prev));
        setShowTrouble(false);
        return;
      }
      const next = delays[idx];
      idx += 1;
      if (next !== undefined) timer = setTimeout(() => void poll(), next);
    };
    void poll();

    const troubleTimer = setTimeout(() => {
      if (!cancelled) setShowTrouble(true);
    }, TROUBLE_GRACE_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearTimeout(troubleTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdatePasswordInput>({ resolver: zodResolver(UpdatePasswordSchema) });

  return (
    <main className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <AuthWordmark />
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
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'update-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="update-password-error" role="alert" className="text-pomegranate text-sm">
                  {errors.password.message}
                </p>
              )}
            </label>
            <label className="block">
              <span className="text-sm text-ink-soft">{t('auth.update_password.confirm')}</span>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={recovery !== 'ready'}
                aria-invalid={errors.confirm ? true : undefined}
                aria-describedby={errors.confirm ? 'update-confirm-error' : undefined}
                {...register('confirm')}
              />
              {errors.confirm && (
                <p id="update-confirm-error" role="alert" className="text-pomegranate text-sm">
                  {errors.confirm.message}
                </p>
              )}
            </label>
            {serverError && (
              <p role="alert" aria-live="assertive" className="text-pomegranate text-sm">
                {serverError}
              </p>
            )}
            {recovery !== 'ready' && showTrouble && (
              <div className="rounded-[var(--radius-md)] border border-cream-line bg-paper px-3 py-3 text-sm space-y-1">
                <p className="text-ink-soft">{t('auth.update_password.trouble')}</p>
                <Link to="/auth/reset" className="underline">
                  {t('auth.update_password.request_new')}
                </Link>
              </div>
            )}
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
