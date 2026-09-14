// Header for the followed-household browse view. Stands in for HomeGreeting
// there: without it the page greets you by name over "What are we cooking?",
// exactly as it does for your own collection, so nothing on screen says whose
// recipes these are or that you can keep one of them.

import { cn } from '@/ui/cn';
import { Link } from '@tanstack/react-router';
import { Bookmark, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type FollowedHouseholdBannerProps = {
  /** The followed household's name. Absent while the household query loads. */
  householdName?: string;
  /** The viewer's own household, for the way back. Empty hides the link. */
  myHouseholdId?: string;
  /** Whether saving is actually available here; hides the hint when it isn't. */
  canSave?: boolean;
  className?: string;
};

export function FollowedHouseholdBanner({
  householdName,
  myHouseholdId,
  canSave = true,
  className,
}: FollowedHouseholdBannerProps) {
  const { t } = useTranslation();

  return (
    <section className={cn('mb-6', className)}>
      {myHouseholdId ? (
        <Link
          to="/h/$householdId"
          params={{ householdId: myHouseholdId }}
          className="mb-2 inline-flex items-center gap-1 font-mono text-[0.72rem] text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-saffron"
        >
          <ChevronLeft size={13} strokeWidth={1.75} aria-hidden="true" />
          {t('following.browse_back')}
        </Link>
      ) : (
        <p className="font-mono text-[0.72rem] text-ink-soft">{t('following.title')}</p>
      )}
      <h1 className="mt-1 font-display text-[1.92rem] font-semibold leading-[1.07] tracking-[-0.015em] text-ink sm:text-[2.05rem]">
        {householdName ? t('following.browse_title', { name: householdName }) : ''}
      </h1>
      {canSave && (
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
          <Bookmark
            size={15}
            strokeWidth={1.5}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-saffron"
          />
          <span>{t('following.browse_help')}</span>
        </p>
      )}
    </section>
  );
}
