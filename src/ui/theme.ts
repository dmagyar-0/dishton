// Mirror of tokens.css used for Motion animations and JS-driven measurements.
// Parity with tokens.css is asserted by `theme.test.ts`.

export const theme = {
  duration: { fast: 140, base: 240, slow: 420 },
  ease: {
    paper: [0.2, 0.7, 0.1, 1.05] as const,
    stamp: [0.4, 1.6, 0.6, 1] as const,
  },
  color: {
    paper: 'var(--color-paper)',
    paper2: 'var(--color-paper-2)',
    ink: 'var(--color-ink)',
    inkSoft: 'var(--color-ink-soft)',
    inkMuted: 'var(--color-ink-muted)',
    saffron: 'var(--color-saffron)',
    saffronInk: 'var(--color-saffron-ink)',
    sage: 'var(--color-sage)',
    sageInk: 'var(--color-sage-ink)',
    aubergine: 'var(--color-aubergine)',
    pomegranate: 'var(--color-pomegranate)',
    creamLine: 'var(--color-cream-line)',
    // Soft Contrast additions (see tokens.css)
    blueberry: 'var(--color-blueberry)',
    accentInk: 'var(--color-accent-ink)',
    banana: 'var(--color-banana)',
    mint: 'var(--color-mint)',
    vanilla: 'var(--color-vanilla)',
    peach: 'var(--color-peach)',
    terracotta: 'var(--color-terracotta)',
    softGreen: 'var(--color-soft-green)',
    latte: 'var(--color-latte)',
    choc: 'var(--color-choc)',
  },
  radius: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    pill: 'var(--radius-pill)',
  },
} as const;

export type Theme = typeof theme;
