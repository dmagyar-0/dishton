import { supabase } from '@/lib/supabase';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
});

function CallbackPage() {
  const nav = useNavigate();
  useEffect(() => {
    void (async () => {
      // Supabase client auto-detects the session in the URL via
      // detectSessionInUrl: true. Just wait for it then redirect.
      await supabase.auth.getSession();
      await nav({ to: '/' });
    })();
  }, [nav]);
  return (
    <main className="min-h-dvh grid place-items-center text-ink-soft">Signing you in&hellip;</main>
  );
}
