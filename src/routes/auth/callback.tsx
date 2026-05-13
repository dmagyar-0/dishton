import { supabase } from '@/lib/supabase';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
});

function CallbackPage() {
  const nav = useNavigate();
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
        void nav({ to: '/auth/update-password' });
      }
    });

    void (async () => {
      // Supabase client auto-detects the session in the URL via
      // detectSessionInUrl: true. Just wait for it then redirect.
      await supabase.auth.getSession();
      if (cancelled) return;
      await nav({ to: isRecovery ? '/auth/update-password' : '/' });
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [nav]);
  return (
    <main className="min-h-dvh grid place-items-center text-ink-soft">Signing you in&hellip;</main>
  );
}
