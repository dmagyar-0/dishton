// Artsy "cut-paper" produce glyphs for the Home meal categories — the Lane 3
// (Soft Contrast) look. Each glyph is composed from absolutely-positioned
// border-radius blobs inside a 34px box and pushed through the shared #rough
// displacement filter (see RoughFilterDefs) to fake a hand-printed edge. These
// are deliberate stand-ins for eventual commissioned linocut art.
//
// Categories ARE recipe tags (src/domain/default-tags.ts). Every tag in the
// curated default library has a bespoke glyph here; any other tag (custom
// household tags) falls back to the lucide pictogram from categoryIcons, so
// tiles still work for every allowed tag.

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
  snack: { tint: 'bg-vanilla', tex: 'tx-stripe' },
  dessert: { tint: 'bg-mint', tex: 'tx-speck' },
  soup: { tint: 'bg-banana', tex: 'tx-half' },
  salad: { tint: 'bg-mint', tex: 'tx-linen' },
  vegetarian: { tint: 'bg-peach', tex: 'tx-half' },
  vegan: { tint: 'bg-banana', tex: 'tx-speck' },
  meat: { tint: 'bg-peach', tex: 'tx-linen' },
  fish: { tint: 'bg-vanilla', tex: 'tx-half' },
  quick: { tint: 'bg-banana', tex: 'tx-stripe' },
  drinks: { tint: 'bg-vanilla', tex: 'tx-speck' },
  baby: { tint: 'bg-mint', tex: 'tx-half' },
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
  // stacked sandwich: bun, lettuce, filling, bun — reads clearly as "lunch"
  lunch: (
    <>
      {blob({
        width: 24,
        height: 12,
        left: 5,
        top: 5,
        borderRadius: '50% 50% 22% 22%',
        background: 'var(--color-saffron)',
      })}
      {blob({
        width: 3,
        height: 2,
        left: 11,
        top: 9,
        borderRadius: '50%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 3,
        height: 2,
        left: 19,
        top: 8,
        borderRadius: '50%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 28,
        height: 6,
        left: 3,
        top: 15,
        borderRadius: '50%',
        background: 'var(--color-soft-green)',
      })}
      {blob({
        width: 26,
        height: 6,
        left: 4,
        top: 18,
        borderRadius: '30%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 24,
        height: 9,
        left: 5,
        top: 22,
        borderRadius: '20% 20% 50% 50%',
        background: 'var(--color-peach)',
      })}
    </>
  ),
  // dinner plate + fork & knife (a place setting — reads as "dinner", not fruit)
  dinner: (
    <>
      {blob({
        width: 22,
        height: 22,
        left: 7,
        top: 6,
        borderRadius: '50%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 16,
        height: 16,
        left: 10,
        top: 9,
        borderRadius: '50%',
        background: '#fbf3e2',
      })}
      {blob({
        width: 4,
        height: 22,
        left: 2,
        top: 6,
        borderRadius: 2,
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 4,
        height: 22,
        left: 28,
        top: 6,
        borderRadius: 2,
        background: 'var(--color-blueberry)',
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
  // popcorn box (striped) + kernels mounding over the top
  snack: (
    <>
      {blob({
        width: 22,
        height: 19,
        left: 6,
        top: 13,
        borderRadius: '8% 8% 16% 16%',
        background: 'var(--color-pomegranate)',
      })}
      {blob({
        width: 5,
        height: 19,
        left: 14,
        top: 13,
        borderRadius: 2,
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 3,
        top: 5,
        borderRadius: '55% 45% 50% 50%/55% 50% 50% 45%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 18,
        top: 5,
        borderRadius: '45% 55% 50% 50%/50% 55% 45% 50%',
        background: '#fbf3e2',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 10,
        top: 8,
        borderRadius: '50%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 13,
        height: 13,
        left: 11,
        top: 0,
        borderRadius: '50% 50% 48% 52%/52% 48% 50% 50%',
        background: '#fbf3e2',
      })}
    </>
  ),
  // shallow bowl heaped with salad leaves
  salad: (
    <>
      {blob({
        width: 30,
        height: 14,
        left: 2,
        top: 20,
        borderRadius: '0 0 65% 65%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 26,
        height: 6,
        left: 4,
        top: 18,
        borderRadius: '50%',
        background: 'var(--color-soft-green)',
      })}
      {blob({
        width: 15,
        height: 16,
        left: 3,
        top: 6,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
        transform: 'rotate(-20deg)',
      })}
      {blob({
        width: 15,
        height: 16,
        left: 16,
        top: 6,
        borderRadius: '80% 0 80% 0',
        background: 'var(--color-soft-green)',
        transform: 'rotate(20deg)',
      })}
      {blob({
        width: 14,
        height: 16,
        left: 10,
        top: 4,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
      })}
    </>
  ),
  // single broad leaf with stem + vein
  vegetarian: (
    <>
      {blob({
        width: 22,
        height: 22,
        left: 8,
        top: 4,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
        transform: 'rotate(-8deg)',
      })}
      {blob({
        width: 4,
        height: 10,
        left: 6,
        top: 22,
        borderRadius: 2,
        background: 'var(--color-latte)',
        transform: 'rotate(45deg)',
      })}
      {blob({
        width: 3,
        height: 16,
        left: 17,
        top: 8,
        borderRadius: 2,
        background: 'var(--color-latte)',
        transform: 'rotate(-45deg)',
      })}
    </>
  ),
  // seedling sprout: two leaves opening from a stem in a soil mound
  vegan: (
    <>
      {blob({
        width: 16,
        height: 9,
        left: 9,
        top: 25,
        borderRadius: '0 0 60% 60%',
        background: 'var(--color-latte)',
      })}
      {blob({
        width: 3,
        height: 14,
        left: 15,
        top: 13,
        borderRadius: 2,
        background: 'var(--color-soft-green)',
      })}
      {blob({
        width: 10,
        height: 12,
        left: 4,
        top: 3,
        borderRadius: '0 80% 0 80%',
        background: 'var(--color-soft-green)',
        transform: 'rotate(-32deg)',
      })}
      {blob({
        width: 10,
        height: 12,
        left: 20,
        top: 3,
        borderRadius: '80% 0 80% 0',
        background: 'var(--color-soft-green)',
        transform: 'rotate(32deg)',
      })}
    </>
  ),
  // chicken drumstick: meat lobe + bone
  meat: (
    <>
      {blob({
        width: 21,
        height: 21,
        left: 2,
        top: 11,
        borderRadius: '62% 50% 55% 50%/55% 60% 50% 58%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 12,
        height: 12,
        left: 14,
        top: 10,
        borderRadius: '55% 50% 50% 60%/55% 55% 50% 50%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 3,
        height: 16,
        left: 20,
        top: 3,
        borderRadius: 2,
        background: '#fbf3e2',
        transform: 'rotate(34deg)',
      })}
      {blob({
        width: 8,
        height: 8,
        left: 22,
        top: 1,
        borderRadius: '50%',
        background: '#fbf3e2',
      })}
    </>
  ),
  // fish in profile: body + tail + eye
  fish: (
    <>
      {blob({
        width: 22,
        height: 16,
        left: 9,
        top: 9,
        borderRadius: '50% 50% 50% 50%/55% 45% 55% 45%',
        background: 'var(--color-saffron)',
      })}
      {blob({
        width: 11,
        height: 20,
        left: 1,
        top: 7,
        borderRadius: '100% 0 0 100%/80% 50% 50% 20%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 5,
        height: 5,
        left: 23,
        top: 13,
        borderRadius: '50%',
        background: 'var(--color-blueberry)',
      })}
    </>
  ),
  // stopwatch — quick / ready-in-minutes
  quick: (
    <>
      {blob({
        width: 6,
        height: 4,
        left: 14,
        top: 3,
        borderRadius: '40% 40% 0 0',
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 24,
        height: 24,
        left: 5,
        top: 7,
        borderRadius: '50%',
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 17,
        height: 17,
        left: 8.5,
        top: 10.5,
        borderRadius: '50%',
        background: '#fbf3e2',
      })}
      {blob({
        width: 2.5,
        height: 8,
        left: 16,
        top: 11,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 7,
        height: 2.5,
        left: 17,
        top: 18,
        borderRadius: 2,
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 3,
        height: 3,
        left: 16,
        top: 18,
        borderRadius: '50%',
        background: 'var(--color-saffron)',
      })}
    </>
  ),
  // tall cold drink: glass with liquid, rim + straw
  drinks: (
    <>
      {blob({
        width: 18,
        height: 25,
        left: 7,
        top: 7,
        borderRadius: '18% 18% 45% 45%',
        background: 'var(--color-blueberry)',
      })}
      {blob({
        width: 14,
        height: 17,
        left: 9,
        top: 13,
        borderRadius: '12% 12% 45% 45%',
        background: 'var(--color-pomegranate)',
      })}
      {blob({
        width: 16,
        height: 5,
        left: 8,
        top: 9,
        borderRadius: '50%',
        background: 'var(--color-banana)',
      })}
      {blob({
        width: 4,
        height: 22,
        left: 17,
        top: 1,
        borderRadius: 2,
        background: 'var(--color-saffron)',
        transform: 'rotate(20deg)',
      })}
    </>
  ),
  // baby bottle: teat cap, collar, body + milk fill
  baby: (
    <>
      {blob({
        width: 9,
        height: 7,
        left: 12.5,
        top: 1,
        borderRadius: '50% 50% 35% 35%',
        background: 'var(--color-terracotta)',
      })}
      {blob({
        width: 14,
        height: 4,
        left: 10,
        top: 7,
        borderRadius: 2,
        background: 'var(--color-saffron)',
      })}
      {blob({
        width: 22,
        height: 24,
        left: 6,
        top: 9,
        borderRadius: '40% 40% 45% 45%/30% 30% 55% 55%',
        background: '#fbf3e2',
      })}
      {blob({
        width: 22,
        height: 14,
        left: 6,
        top: 19,
        borderRadius: '0 0 45% 45%/0 0 80% 80%',
        background: 'var(--color-saffron)',
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
