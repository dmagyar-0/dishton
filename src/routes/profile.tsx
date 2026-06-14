import { normaliseBcp47 } from '@/domain/language';
import { useAuth } from '@/lib/auth';
import { UI_LANGUAGES, applyUiLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { Button, Card, Input, Select, useToast } from '@/ui/primitives';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from './_guards';

export const Route = createFileRoute('/profile')({
  beforeLoad: requireAuth,
  component: ProfilePage,
});

// Languages offered for the *recipe* translation default. Recipe content is
// translated server-side, so we can offer more than the UI ships strings for.
// Labels are in their own language so the choice is recognisable regardless of
// UI locale.
const RECIPE_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
  { value: 'hu', label: 'Magyar' },
];

// The "Display language" picker only offers locales we actually ship UI
// strings for (UI_LANGUAGES) — otherwise the interface silently falls back to
// English while the picker claims another language is selected.
const DISPLAY_LANGUAGE_OPTIONS = UI_LANGUAGES;

function ProfilePage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [name, setName] = useState('');
  const currentLanguage = auth.profile?.preferred_language ?? 'en';
  const currentLocale = auth.profile?.locale ?? 'en';
  const currentUnits = auth.profile?.preferred_unit_system ?? 'metric';

  useEffect(() => {
    if (auth.profile?.display_name) setName(auth.profile.display_name);
  }, [auth.profile?.display_name]);

  const nameDirty = name.trim().length > 0 && name.trim() !== auth.profile?.display_name;

  async function saveDisplayName(): Promise<void> {
    const profile = auth.profile;
    if (!profile) return;
    const next = name.trim();
    if (next.length === 0 || next.length > 80 || next === profile.display_name) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: next })
      .eq('id', profile.id);
    setSaving(false);
    if (error) {
      push({ variant: 'error', title: t('profile.save_failed') });
      return;
    }
    useAuth.getState().setProfile({ ...profile, display_name: next });
    push({ variant: 'success', title: t('profile.saved') });
  }

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
    // Note: preferred_language is the recipe-translation default, NOT the
    // interface language. The UI language is driven by `locale` (see
    // onLocaleChange / the auth bootstrap), so we do not call applyUiLanguage
    // here.
    push({ variant: 'success', title: t('profile.language_saved') });
  }

  async function onLocaleChange(value: string): Promise<void> {
    const profile = auth.profile;
    if (!profile) return;
    const next = normaliseBcp47(value) ?? 'en';
    if (next === profile.locale) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ locale: next }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      push({ variant: 'error', title: t('profile.save_failed') });
      return;
    }
    useAuth.getState().setProfile({ ...profile, locale: next });
    // `locale` is the interface language ("Display language"); apply it
    // immediately so the UI switches without a reload.
    applyUiLanguage(next);
    push({ variant: 'success', title: t('profile.saved') });
  }

  async function onUnitsChange(value: string): Promise<void> {
    const profile = auth.profile;
    if (!profile) return;
    const next = value === 'imperial' ? 'imperial' : 'metric';
    if (next === profile.preferred_unit_system) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_unit_system: next })
      .eq('id', profile.id);
    setSaving(false);
    if (error) {
      push({ variant: 'error', title: t('profile.save_failed') });
      return;
    }
    useAuth.getState().setProfile({ ...profile, preferred_unit_system: next });
    push({ variant: 'success', title: t('profile.saved') });
  }

  async function signOutEverywhere(): Promise<void> {
    setSigningOutAll(true);
    // Global scope revokes refresh tokens on every device, not just this one.
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setSigningOutAll(false);
    if (error) {
      push({ variant: 'error', title: t('profile.sign_out_all_failed') });
      return;
    }
    // Global signOut already revoked the session and will emit SIGNED_OUT
    // (the auth subscriber clears the store + Sentry context). Navigate to
    // login; no second local signOut call is needed.
    await nav({ to: '/auth/login' });
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.profile')}</h1>

      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="profile-display-name" className="text-ink-soft text-sm block">
            {t('auth.display_name')}
          </label>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                id="profile-display-name"
                value={name}
                maxLength={80}
                disabled={saving || !auth.profile}
                onChange={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button onClick={() => void saveDisplayName()} disabled={!nameDirty || saving}>
              {t('profile.save')}
            </Button>
          </div>
        </div>
        <p className="text-ink-soft text-sm">{auth.user?.email}</p>
      </Card>

      <Card className="p-6 mt-4 space-y-4">
        <div className="space-y-2">
          <label htmlFor="profile-units" className="text-ink-soft text-sm block">
            {t('profile.units_label')}
          </label>
          <Select
            id="profile-units"
            value={currentUnits}
            options={[
              { value: 'metric', label: t('profile.units_metric') },
              { value: 'imperial', label: t('profile.units_imperial') },
            ]}
            disabled={saving || !auth.profile}
            onValueChange={(v) => void onUnitsChange(v)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-locale" className="text-ink-soft text-sm block">
            {t('profile.locale_label')}
          </label>
          <Select
            id="profile-locale"
            value={currentLocale}
            options={DISPLAY_LANGUAGE_OPTIONS}
            disabled={saving || !auth.profile}
            onValueChange={(v) => void onLocaleChange(v)}
          />
          <p className="text-ink-soft text-sm">{t('profile.locale_hint')}</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="preferred-language" className="text-ink-soft text-sm block">
            {t('profile.language_label')}
          </label>
          <Select
            id="preferred-language"
            value={currentLanguage}
            options={RECIPE_LANGUAGE_OPTIONS}
            disabled={saving || !auth.profile}
            onValueChange={(v) => void onLanguageChange(v)}
          />
          <p className="text-ink-soft text-sm">{t('profile.language_hint')}</p>
        </div>
      </Card>

      <Card className="p-6 mt-4 space-y-3">
        <Button
          variant="ghost"
          onClick={async () => {
            await auth.signOut();
            await nav({ to: '/auth/login' });
          }}
        >
          {t('profile.sign_out')}
        </Button>
        <div>
          <Button
            variant="ghost"
            onClick={() => void signOutEverywhere()}
            disabled={signingOutAll}
            loading={signingOutAll}
          >
            {t('profile.sign_out_all')}
          </Button>
          <p className="text-ink-soft text-sm mt-1">{t('profile.sign_out_all_hint')}</p>
        </div>
      </Card>
    </main>
  );
}
