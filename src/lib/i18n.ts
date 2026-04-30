// Bootstrap i18next with `en` and `de` resources. App-shell strings only;
// recipe content is translated server-side via the translate-recipe Edge
// Function and cached in `recipe_translations`.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './i18n.de';
import en from './i18n.en';

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export { i18next };
