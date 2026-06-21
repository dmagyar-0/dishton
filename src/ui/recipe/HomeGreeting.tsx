// The Home screen header (Lane 3): a mono eyebrow with a time-based greeting
// over a large Fraunces headline. Replaces the old printed household banner.
// Reads the signed-in user's display name from the auth store and the time of
// day from the client clock — purely presentational, no I/O.

import { useAuth } from '@/lib/auth';
import { Trans, useTranslation } from 'react-i18next';

type Period = 'morning' | 'afternoon' | 'evening';

function periodForHour(hour: number): Period {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export type HomeGreetingProps = {
  /** First name to greet. Defaults to the signed-in profile's display name. */
  name?: string;
};

export function HomeGreeting({ name }: HomeGreetingProps) {
  const { t } = useTranslation();
  const displayName = useAuth((s) => s.profile?.display_name);
  // First whitespace-delimited token only; an empty/missing name drops the
  // trailing ", {name}" so the eyebrow reads as a plain "Good morning".
  const firstName = (name ?? displayName ?? '').trim().split(/\s+/)[0] ?? '';

  const period = t(`home.period_${periodForHour(new Date().getHours())}`);
  const eyebrow = firstName
    ? t('home.greeting', { period, name: firstName })
    : t('home.greeting_noname', { period });

  return (
    <section className="mb-6">
      <p className="font-mono text-[0.72rem] text-ink-soft">{eyebrow}</p>
      <h1 className="mt-2 max-w-[13ch] font-display text-[1.92rem] font-semibold leading-[1.07] tracking-[-0.015em] text-ink sm:text-[2.05rem]">
        <Trans i18nKey="home.question" components={{ 1: <span className="text-saffron" /> }} />
      </h1>
    </section>
  );
}
