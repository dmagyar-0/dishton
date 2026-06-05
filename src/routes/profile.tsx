import { normaliseBcp47 } from '@/domain/language';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button, Card, Select, useToast } from '@/ui/primitives';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from './_guards';

export const Route = createFileRoute('/profile')({
  beforeLoad: requireAuth,
  component: ProfilePage,
});

// Curated set of languages we offer in the picker. Labels are in their own
// language so the choice is recognisable regardless of UI locale.
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
  { value: 'hu', label: 'Magyar' },
];

function ProfilePage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const currentLanguage = auth.profile?.preferred_language ?? 'en';

  async function onLanguageChange(value: string): Promise<void> {
    const profile = auth.profile;
    if (!profile) return;
    const next = normaliseBcp47(value) ?? 'en';
    if (next === profile.preferred_language) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_language: next })
      .eq('id', profile.id);
    setSaving(false);
    if (error) {
      push({ variant: 'error', title: t('profile.language_save_failed') });
      return;
    }
    useAuth.getState().setProfile({ ...profile, preferred_language: next });
    push({ variant: 'success', title: t('profile.language_saved') });
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.profile')}</h1>
      <Card className="p-6 space-y-3">
        <p>
          <span className="text-ink-soft text-sm">Display name</span>
          <br />
          <strong className="font-display text-xl">
            {auth.profile?.display_name ?? 'Loading…'}
          </strong>
        </p>
        <p className="text-ink-soft text-sm">{auth.user?.email}</p>
        <Button
          variant="ghost"
          onClick={async () => {
            await auth.signOut();
            await nav({ to: '/auth/login' });
          }}
        >
          Sign out
        </Button>
      </Card>
      <Card className="p-6 mt-4 space-y-2">
        <label htmlFor="preferred-language" className="text-ink-soft text-sm block">
          {t('profile.language_label')}
        </label>
        <Select
          id="preferred-language"
          options={LANGUAGE_OPTIONS}
          value={currentLanguage}
          disabled={saving || !auth.profile}
          onValueChange={(v) => void onLanguageChange(v)}
        />
        <p className="text-ink-soft text-sm">{t('profile.language_hint')}</p>
      </Card>
    </main>
  );
}
