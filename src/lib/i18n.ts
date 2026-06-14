// Bootstrap i18next with the resources we ship UI strings for. App-shell
// strings only; recipe content is translated server-side via the
// translate-recipe Edge Function and cached in `recipe_translations`.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './i18n.de';
import en from './i18n.en';
import hu from './i18n.hu';

// Languages we actually ship UI strings for, with native labels for the
// "Display language" picker in /profile. This is the single source of truth:
// the recipe-language picker offers more languages (translated server-side),
// but the interface only renders the locales listed here — any other display
// preference falls back to en. Keep this in sync with the `resources` below.
export const UI_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'hu', label: 'Magyar' },
];

const SUPPORTED_UI_LANGUAGES = UI_LANGUAGES.map((l) => l.value);

// Resolve the initial UI language from the browser preference, narrowed to a
// language we have resources for. The persisted profile preference, once
// loaded, overrides this via `i18next.changeLanguage` in the auth bootstrap.
function detectInitialLanguage(): string {
  const candidates: string[] = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split('-')[0];
    if (base && SUPPORTED_UI_LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    hu: { translation: hu },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_UI_LANGUAGES,
  interpolation: { escapeValue: false },
});

// Switch the interface language, narrowing to a supported UI language so an
// unsupported recipe-language preference (e.g. `fr`) leaves the UI on its
// fallback rather than rendering raw keys. Returns a promise the caller may
// ignore.
export function applyUiLanguage(language: string | null | undefined): void {
  const base = (language ?? '').toLowerCase().split('-')[0];
  const next = base && SUPPORTED_UI_LANGUAGES.includes(base) ? base : 'en';
  if (i18next.language !== next) void i18next.changeLanguage(next);
}

export { i18next };
