import { useAuth } from '@/lib/auth';
import { authErrorCopy } from '@/lib/auth-errors';
import { type ChangePasswordInput, ChangePasswordSchema } from '@/lib/forms/auth';
import { supabase } from '@/lib/supabase';
import { Button, Card, Input, useToast } from '@/ui/primitives';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export function ChangePasswordCard() {
  const { t } = useTranslation();
  const { push } = useToast();
  const email = useAuth((s) => s.user?.email ?? null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(ChangePasswordSchema) });

  async function onSubmit(values: ChangePasswordInput): Promise<void> {
    if (!email) {
      push({ variant: 'error', title: t('profile.password.update_failed') });
      return;
    }
    // Supabase's updateUser does not verify the current password, so anyone
    // with an unlocked session could otherwise change it silently. Re-auth with
    // the supplied current password first; a failure here means it was wrong.
    const reauth = await supabase.auth.signInWithPassword({
      email,
      password: values.current_password,
    });
    if (reauth.error) {
      setError('current_password', { message: t('profile.password.current_incorrect') });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      push({
        variant: 'error',
        title: t('profile.password.update_failed'),
        description: authErrorCopy(error.message),
      });
      return;
    }

    reset();
    push({ variant: 'success', title: t('profile.password.updated') });
  }

  return (
    <Card className="p-6 mt-4 space-y-4">
      <div>
        <h2 className="font-display text-xl mb-1">{t('profile.password.title')}</h2>
        <p className="text-ink-soft text-sm">{t('profile.password.hint')}</p>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <label className="block space-y-1" htmlFor="change-current-password">
          <span className="text-sm text-ink-soft">{t('profile.password.current_label')}</span>
          <Input
            id="change-current-password"
            type="password"
            autoComplete="current-password"
            disabled={isSubmitting}
            aria-invalid={errors.current_password ? true : undefined}
            aria-describedby={errors.current_password ? 'change-current-password-error' : undefined}
            {...register('current_password')}
          />
          {errors.current_password && (
            <p id="change-current-password-error" role="alert" className="text-pomegranate text-sm">
              {errors.current_password.message}
            </p>
          )}
        </label>

        <label className="block space-y-1" htmlFor="change-new-password">
          <span className="text-sm text-ink-soft">{t('profile.password.new_label')}</span>
          <Input
            id="change-new-password"
            type="password"
            autoComplete="new-password"
            disabled={isSubmitting}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'change-new-password-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="change-new-password-error" role="alert" className="text-pomegranate text-sm">
              {errors.password.message}
            </p>
          )}
        </label>

        <label className="block space-y-1" htmlFor="change-confirm-password">
          <span className="text-sm text-ink-soft">{t('profile.password.confirm_label')}</span>
          <Input
            id="change-confirm-password"
            type="password"
            autoComplete="new-password"
            disabled={isSubmitting}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? 'change-confirm-password-error' : undefined}
            {...register('confirm')}
          />
          {errors.confirm && (
            <p id="change-confirm-password-error" role="alert" className="text-pomegranate text-sm">
              {errors.confirm.message}
            </p>
          )}
        </label>

        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {t('profile.password.submit')}
        </Button>
      </form>
    </Card>
  );
}
