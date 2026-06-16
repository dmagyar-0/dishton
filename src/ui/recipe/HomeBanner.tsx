// The Lane 3 "printed banner" for the Home screen: a full-width blueberry block
// with the household name, a mono eyebrow, an Import action, and cut-paper
// produce blobs bleeding off the top-right. Blobs use the shared #rough filter
// (rendered once in AppShell) and are purely decorative.

import { Button } from '@/ui/primitives/Button';
import { Link } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

export type HomeBannerProps = {
  householdId: string;
  /** Mono eyebrow above the title, e.g. "Household". */
  eyebrow: string;
  /** Large display title — the household name. */
  title: string;
};

type BlobProps = { style: CSSProperties; tex?: string };

function Blob({ style, tex }: BlobProps) {
  return (
    <span className="absolute" style={{ filter: 'url(#rough)', ...style }}>
      {tex ? (
        <span
          className={tex}
          style={{
            position: 'absolute',
            inset: 0,
            mixBlendMode: 'multiply',
            opacity: 0.4,
            borderRadius: 'inherit',
          }}
        />
      ) : null}
    </span>
  );
}

export function HomeBanner({ householdId, eyebrow, title }: HomeBannerProps) {
  const { t } = useTranslation();
  return (
    <section className="relative mb-6 overflow-hidden rounded-[var(--radius-lg)] bg-blueberry px-5 py-6 shadow-press sm:px-7 sm:py-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <Blob
          tex="tx-speck"
          style={{
            width: 84,
            height: 78,
            right: -18,
            top: -16,
            borderRadius: '54% 46% 60% 40%/56% 50% 50% 44%',
            background: 'var(--color-saffron)',
          }}
        />
        <Blob
          tex="tx-linen"
          style={{
            width: 54,
            height: 62,
            right: 60,
            bottom: -26,
            borderRadius: '46% 54% 48% 52%/40% 40% 60% 60%',
            background: 'var(--color-mint)',
          }}
        />
        <Blob
          tex="tx-half"
          style={{
            width: 40,
            height: 40,
            right: 104,
            top: 14,
            borderRadius: '50%',
            background: 'var(--color-terracotta)',
          }}
        />
        <Blob
          style={{
            width: 18,
            height: 30,
            right: 6,
            top: 40,
            borderRadius: '0 80% 0 80%',
            background: 'var(--color-soft-green)',
            transform: 'rotate(28deg)',
          }}
        />
      </div>

      <p className="relative z-[2] font-mono text-[0.64rem] uppercase tracking-[0.2em] text-saffron">
        {eyebrow}
      </p>
      {/* Pinned light cream (not `text-paper`, which flips to dark in dark mode):
          the banner is always a navy surface, so its title must always be light. */}
      <h1 className="relative z-[2] mt-2 max-w-[14ch] font-display text-3xl leading-[1.04] text-[#faf3e3] sm:text-4xl">
        {title}
      </h1>
      <div className="relative z-[2] mt-4">
        <Link to="/h/$householdId/import" params={{ householdId }}>
          <Button leftIcon={<Upload size={18} strokeWidth={1.7} aria-hidden="true" />}>
            {t('recipe.import_recipe')}
          </Button>
        </Link>
      </div>
    </section>
  );
}
