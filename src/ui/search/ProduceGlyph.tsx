// Artsy "cut-paper" produce glyphs for the Home meal categories — the Lane 3
// (Soft Contrast) look. Each glyph is composed from absolutely-positioned
// border-radius blobs inside a 34px box and pushed through the shared #rough
// displacement filter (see RoughFilterDefs) to fake a hand-printed edge. These
// are deliberate stand-ins for eventual commissioned linocut art.
//
// Categories ARE recipe tags (src/domain/default-tags.ts). Only the curated
// default library has a bespoke glyph; any other tag (custom household tags)
// falls back to the lucide pictogram from categoryIcons, so tiles still work
// for every allowed tag.

import { cn } from '@/ui/cn';
import type { CSSProperties, ReactNode } from 'react';
import { categoryIcon } from './categoryIcons';

type Disc = { tint: string; tex: string };

// Per-category disc tint + print texture (Tailwind classes; the bg-* utilities
// come from the produce tokens added in tokens.css). Default covers custom tags.
const DISCS: Record<string, Disc> = {
  all: { tint: 'bg-banana', tex: 'tx-linen' },
  breakfast: { tint: 'bg-mint', tex: 'tx-half' },
  lunch: { tint: 'bg-vanilla', tex: 'tx-stripe' },
  dinner: { tint: 'bg-peach', tex: 'tx-linen' },
  dessert: { tint: 'bg-mint', tex: 'tx-speck' },
  soup: { tint: 'bg-banana', tex: 'tx-half' },
};
const DEFAULT_DISC: Disc = { tint: 'bg-vanilla', tex: 'tx-linen' };

/** Disc tint + texture classes for a category (default tint for custom tags). */
export function categoryDisc(id: string): Disc {
  return DISCS[id] ?? DEFAULT_DISC;
}

const blob = (style: CSSProperties): ReactNode => <span style={style} />;

// Blob compositions, transcribed from the Lane 3 design. Coordinates are in the
// 34px glyph box. Colours reference the produce tokens.
const GLYPHS: Record<string, ReactNode> = {
  // fruit cluster
  all: (
    <>
      {blob({
        width: 16,
        height: 16,
        left: 1,
        top: 11,
        borderRadius: '50%',
        background: 'var(--color-saffron)',
      })}
      {blob({
        width: 16,
        height: 16,
        left: 16,
        top: 11,
        borderRadius: '50%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 11,
        top: 2,
        borderRadius: '50%',
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 8,
        height: 13,
        left: 21,
        top: 0,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
        transform: 'rotate(20deg)',
      })}
    </>
  ),
  // fried egg
  breakfast: (
    <>
      {blob({
        width: 28,
        height: 21,
        left: 3,
        top: 8,
        borderRadius: '60% 40% 55% 45%/62% 58% 42% 38%',
        background: '#fbf3e2',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 11,
        top: 12,
        borderRadius: '50%',
        background: 'var(--color-saffron)',
      })}
    </>
  ),
  // bowl + chopsticks
  lunch: (
    <>
      {blob({
        width: 30,
        height: 15,
        left: 2,
        top: 14,
        borderRadius: '0 0 60% 60%',
        background: 'var(--color-saffron)',
      })}
      {blob({
        width: 28,
        height: 6,
        left: 3,
        top: 12,
        borderRadius: '50%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 3,
        height: 7,
        left: 9,
        top: 5,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
        transform: 'rotate(-18deg)',
      })}
      {blob({
        width: 3,
        height: 7,
        left: 22,
        top: 5,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
        transform: 'rotate(18deg)',
      })}
    </>
  ),
  // apple
  dinner: (
    <>
      {blob({
        width: 22,
        height: 22,
        left: 6,
        top: 10,
        borderRadius: '50% 50% 48% 52%/46% 46% 54% 54%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 3,
        height: 8,
        left: 16,
        top: 3,
        borderRadius: 2,
        background: 'var(--color-choc)',
      })}
      {blob({
        width: 9,
        height: 14,
        left: 19,
        top: 2,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
        transform: 'rotate(22deg)',
      })}
    </>
  ),
  // cookie
  dessert: (
    <>
      {blob({
        width: 24,
        height: 24,
        left: 5,
        top: 6,
        borderRadius: '50%',
        background: 'var(--color-latte)',
      })}
      {blob({
        width: 5,
        height: 5,
        left: 10,
        top: 11,
        borderRadius: '50%',
        background: 'var(--color-choc)',
      })}
      {blob({
        width: 5,
        height: 5,
        left: 18,
        top: 14,
        borderRadius: '50%',
        background: 'var(--color-choc)',
      })}
      {blob({
        width: 5,
        height: 5,
        left: 14,
        top: 20,
        borderRadius: '50%',
        background: 'var(--color-choc)',
      })}
    </>
  ),
  // soup bowl + steam
  soup: (
    <>
      {blob({
        width: 30,
        height: 14,
        left: 2,
        top: 16,
        borderRadius: '0 0 60% 60%',
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 28,
        height: 6,
        left: 3,
        top: 14,
        borderRadius: '50%',
        background: 'var(--color-soft-green)',
      })}
      {blob({
        width: 3,
        height: 9,
        left: 11,
        top: 3,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
        transform: 'rotate(-14deg)',
      })}
      {blob({
        width: 3,
        height: 9,
        left: 20,
        top: 3,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
        transform: 'rotate(14deg)',
      })}
    </>
  ),
};

/** True when the category has a bespoke produce glyph (vs. an icon fallback). */
export function hasProduceGlyph(id: string): boolean {
  return id in GLYPHS;
}

export type ProduceGlyphProps = {
  category: string;
  /** Rendered square size in px. The 34px composition scales to fit. */
  size?: number;
  className?: string;
};

/**
 * A category's produce glyph at the requested size, or the lucide pictogram for
 * categories without bespoke art. Always decorative (aria-hidden).
 */
export function ProduceGlyph({ category, size = 22, className }: ProduceGlyphProps) {
  const glyph = GLYPHS[category];
  if (!glyph) {
    const Icon = categoryIcon(category);
    return <Icon size={size} strokeWidth={1.5} aria-hidden="true" className={className} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="produce-gl"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 34,
          height: 34,
          transform: `translate(-50%, -50%) scale(${size / 34})`,
        }}
      >
        {glyph}
      </span>
    </span>
  );
}

/**
 * The shared #rough SVG filter the produce glyphs and banner blobs reference.
 * Render exactly once near the app root so every `filter: url(#rough)` resolves.
 */
export function RoughFilterDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute h-0 w-0">
      <title>print roughen filter</title>
      <filter id="rough">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.02 0.025"
          numOctaves={3}
          seed={4}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={5}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
