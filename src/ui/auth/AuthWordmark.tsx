import { useTranslation } from 'react-i18next';

/**
 * Dishton wordmark shown above the card heading on every auth page.
 * Matches the AppShell header logo style: font-display, text-aubergine.
 */
export function AuthWordmark() {
  const { t } = useTranslation();
  return <p className="font-display text-3xl text-aubergine text-center mb-2">{t('app.name')}</p>;
}
