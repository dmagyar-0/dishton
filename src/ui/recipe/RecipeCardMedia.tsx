import { cn } from '@/ui/cn';
import { RecipeImage } from '@/ui/primitives/RecipeImage';

// Predefined gradient combinations built from the app's design-token palette.
// Each entry is [from-color, to-color] using Tailwind color classes that map
// to the CSS custom properties in tokens.css (saffron, aubergine, sage, paper).
// We keep these muted so the title text — not the image slot — stays the hero.
const GRADIENTS = [
  'from-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-paper))] to-[color-mix(in_srgb,var(--color-paper-2)_80%,var(--color-saffron))]',
  'from-[color-mix(in_srgb,var(--color-aubergine)_18%,var(--color-paper))] to-[color-mix(in_srgb,var(--color-paper-2)_82%,var(--color-aubergine))]',
  'from-[color-mix(in_srgb,var(--color-sage)_18%,var(--color-paper))] to-[color-mix(in_srgb,var(--color-paper-2)_82%,var(--color-sage))]',
  'from-[color-mix(in_srgb,var(--color-pomegranate)_15%,var(--color-paper))] to-[color-mix(in_srgb,var(--color-paper-2)_85%,var(--color-pomegranate))]',
  'from-[color-mix(in_srgb,var(--color-saffron)_12%,var(--color-paper-2))] to-[color-mix(in_srgb,var(--color-paper)_88%,var(--color-ink-muted))]',
  'from-[color-mix(in_srgb,var(--color-aubergine)_12%,var(--color-paper-2))] to-[color-mix(in_srgb,var(--color-paper)_88%,var(--color-sage))]',
] as const;

// Trivial deterministic hash: sum of char codes modulo GRADIENTS.length.
// Same title always maps to the same gradient.
export function titleGradientIndex(title: string): number {
  let sum = 0;
  for (let i = 0; i < title.length; i++) {
    // noUncheckedIndexedAccess: charCodeAt never returns undefined — it returns
    // NaN for out-of-range, but we iterate within bounds here.
    sum += title.charCodeAt(i);
  }
  return sum % GRADIENTS.length;
}

export function gradientClassForTitle(title: string): string {
  const idx = titleGradientIndex(title);
  // GRADIENTS is a const tuple; idx is guaranteed 0..5 by the modulo above.
  // We provide a fallback to satisfy noUncheckedIndexedAccess.
  return GRADIENTS[idx] ?? GRADIENTS[0];
}

type Props = {
  heroImagePath: string | null;
  title: string;
  className?: string;
};

export function RecipeCardMedia({ heroImagePath, title, className }: Props) {
  const wrapperClass = cn(
    'aspect-[16/10] w-full overflow-hidden border-b border-cream-line',
    className,
  );

  if (heroImagePath) {
    return (
      <div className={wrapperClass}>
        <RecipeImage
          path={heroImagePath}
          alt=""
          className="h-full w-full object-cover group-hover/link:scale-[1.02] transition-transform duration-[var(--duration-base)]"
        />
      </div>
    );
  }

  // Decorative placeholder: gradient tint derived from the title, with the
  // first non-whitespace character rendered large in the display font.
  const initial = (title.trimStart()[0] ?? '').toUpperCase();
  const gradientClass = gradientClassForTitle(title);

  return (
    <div aria-hidden="true" className={wrapperClass}>
      <div
        className={cn(
          'h-full w-full bg-gradient-to-br',
          gradientClass,
          'flex items-center justify-center',
          // Scale the initial along with the card image on hover for consistency.
          'group-hover/link:scale-[1.02] transition-transform duration-[var(--duration-base)]',
        )}
      >
        <span className="font-display text-6xl leading-none select-none text-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]">
          {initial}
        </span>
      </div>
    </div>
  );
}
