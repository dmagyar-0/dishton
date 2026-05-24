import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/ui/cn';

const STEP_KEYS = ['reach', 'read', 'distill', 'plate'] as const;

// Auto-advance through Reach -> Read -> Distill, then hold on Distill
// (the model call is the longest, and "Plate" reads as done so we never
// auto-show it while we're still waiting). Plate flips on only when the
// request finishes successfully — see `setStepIndex(3)` in the success
// path below.
const AUTO_ADVANCE_MS: Array<{ index: number; at: number }> = [
  { index: 1, at: 1500 },
  { index: 2, at: 3500 },
];
const LONG_WAIT_MS = 12000;

const EASE_PAPER: [number, number, number, number] = [0.2, 0.7, 0.1, 1.05];

export function ImportProgress({
  active,
  onBackground,
}: { active: boolean; onBackground?: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      setLongWait(false);
      return;
    }
    setStepIndex(0);
    setLongWait(false);
    const timers = AUTO_ADVANCE_MS.map(({ index, at }) =>
      window.setTimeout(() => setStepIndex(index), at),
    );
    timers.push(window.setTimeout(() => setLongWait(true), LONG_WAIT_MS));
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="import-progress"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.32, ease: EASE_PAPER }}
          className={cn(
            'relative mt-4 overflow-hidden rounded-[var(--radius-lg)]',
            'border border-cream-line bg-paper-2 px-6 py-5',
            'shadow-press',
          )}
          role="status"
          aria-live="polite"
          aria-label={t('import.progress_label')}
        >
          {!reduce && <SteamLayer />}

          <div className="relative">
            <p className="font-display italic text-[0.72rem] uppercase tracking-[0.22em] text-ink-muted mb-2">
              {t('import.preparing')}
            </p>

            <div className="font-display text-2xl leading-tight text-ink min-h-[2.4rem]">
              <AnimatePresence mode="wait">
                <motion.span
                  key={STEP_KEYS[stepIndex]}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease: EASE_PAPER }}
                  className="inline-block"
                >
                  {t(`import.step_${STEP_KEYS[stepIndex]}.label`)}
                </motion.span>
              </AnimatePresence>
              <Ellipsis reduce={reduce ?? false} />
            </div>

            <p className="font-body text-sm text-ink-soft mt-1">
              {longWait && stepIndex === 2
                ? t('import.long_wait_hint')
                : t(`import.step_${STEP_KEYS[stepIndex]}.hint`)}
            </p>

            {longWait && onBackground && (
              <button
                type="button"
                onClick={onBackground}
                className={cn(
                  'mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-pill)]',
                  'border border-cream-line bg-paper hover:bg-paper-2 transition-colors',
                  'font-body text-sm text-ink',
                )}
              >
                {t('import.background_button')}
              </button>
            )}

            <InkTrail stepIndex={stepIndex} reduce={reduce ?? false} />

            <ol className="mt-4 grid grid-cols-4 gap-2">
              {STEP_KEYS.map((key, i) => {
                const done = i < stepIndex;
                const isActive = i === stepIndex;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 font-body text-[0.7rem] uppercase tracking-[0.16em]"
                  >
                    <Stamp done={done} isActive={isActive} />
                    <span
                      className={cn(
                        'transition-colors duration-[var(--duration-base)] truncate',
                        isActive ? 'text-ink' : done ? 'text-ink-soft' : 'text-ink-muted',
                      )}
                    >
                      {t(`import.step_${key}.short`)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Ellipsis({ reduce }: { reduce: boolean }) {
  if (reduce) return <span aria-hidden>…</span>;
  return (
    <span aria-hidden className="inline-flex items-baseline ml-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="text-saffron"
          initial={{ opacity: 0.2 }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1.2,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 0.18,
            ease: 'easeInOut',
          }}
        >
          .
        </motion.span>
      ))}
    </span>
  );
}

function InkTrail({ stepIndex, reduce }: { stepIndex: number; reduce: boolean }) {
  const pct = ((stepIndex + 1) / STEP_KEYS.length) * 100;
  return (
    <div
      className="relative mt-5 h-[2px] w-full overflow-hidden rounded-pill bg-cream-line"
      aria-hidden
    >
      <motion.div
        className="absolute inset-y-0 left-0 bg-saffron rounded-pill"
        initial={{ width: '8%' }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: EASE_PAPER }}
      />
      {!reduce && (
        <motion.div
          className="absolute inset-y-[-2px] w-16 bg-gradient-to-r from-transparent via-saffron/70 to-transparent"
          animate={{ x: ['-4rem', '120%'] }}
          transition={{
            duration: 1.9,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'linear',
          }}
        />
      )}
    </div>
  );
}

function Stamp({ done, isActive }: { done: boolean; isActive: boolean }) {
  return (
    <span className="relative inline-flex h-3 w-3 items-center justify-center">
      <motion.span
        initial={false}
        animate={{
          scale: done || isActive ? 1 : 0.55,
          backgroundColor: done
            ? 'var(--color-saffron)'
            : isActive
              ? 'rgba(224,138,26,0.35)'
              : 'transparent',
        }}
        transition={{ duration: 0.32, ease: [0.4, 1.6, 0.6, 1] }}
        className={cn(
          'absolute inset-0 rounded-pill border',
          done ? 'border-saffron' : isActive ? 'border-saffron' : 'border-cream-line',
        )}
      />
      {isActive && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-pill border border-saffron"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 2.2 }}
          transition={{
            duration: 1.6,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeOut',
          }}
        />
      )}
    </span>
  );
}

function SteamLayer() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute bottom-[-2rem] h-32 w-32 rounded-full bg-saffron/[0.08] blur-3xl"
          style={{ left: `${10 + i * 32}%` }}
          initial={{ y: 0, opacity: 0, scale: 0.6 }}
          animate={{
            y: [-10, -160],
            opacity: [0, 0.85, 0],
            scale: [0.6, 1.15, 0.95],
          }}
          transition={{
            duration: 4.6 + i * 0.7,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 1.1,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}
