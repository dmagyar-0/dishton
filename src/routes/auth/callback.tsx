import { sanitizeNextPath } from '@/lib/safe-redirect';
import { supabase } from '@/lib/supabase';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

// See src/routes/auth/login.tsx for the `next` sanitization contract. Signup
// threads its `next` through here via emailRedirectTo.
const Search = z.object({ next: z.string().optional() });

export const Route = createFileRoute('/auth/callback')({
  validateSearch: Search,
  component: CallbackPage,
});

function CallbackPage() {
  const { t } = useTranslation();
  const { next } = Route.useSearch();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    // Password recovery emails issued before /auth/update-password existed
    // (and any future ones that route through here) need to land on the
    // dedicated update-password form, not the home page.
    const isRecovery =
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('type') === 'recovery' ||
        window.location.hash.includes('type=recovery'));

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        router.history.push('/auth/update-password');
      }
    });

    void (async () => {
      // Supabase client auto-detects the session in the URL via
      // detectSessionInUrl: true. Just wait for it then redirect.
      await supabase.auth.getSession();
      if (cancelled) return;
      // Recovery keeps priority over `next` — a password-reset link must
      // always land on the update-password form, even if it somehow also
      // carried a next param.
      router.history.push(isRecovery ? '/auth/update-password' : sanitizeNextPath(next));
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [next, router]);
  return (
    <main className="min-h-dvh grid place-items-center text-ink-soft">
      {t('auth.callback.signing_in')}
    </main>
  );
}
