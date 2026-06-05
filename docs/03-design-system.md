# 03 — Design System ("Editorial Pantry")

## Purpose

Lock the visual language of Dishton so every screen converges on the same
aesthetic. The chosen direction is **Editorial Pantry**: cookbook-magazine
typography crossed with warm kitchen-craft surfaces. This doc specifies the
design tokens, font loading, motion principles, primitive component inventory,
accessibility floor, and the `src/ui/` directory contract. Anything that contradicts
this doc is wrong.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked aesthetic decision.
- [02-tech-stack.md](./02-tech-stack.md) — Tailwind v4, Motion, lucide-react.

## Aesthetic charter

| Pillar | Decision |
|---|---|
| Tone | Editorial cookbook (Bon Appétit / Kinfolk) crossed with warm kitchen-craft. |
| Display type | **Fraunces** variable (Google Fonts), `opsz`, `SOFT`, `WONK` axes used. |
| Body type | **General Sans** variable (Fontshare). |
| Numerals (qty, time) | **JetBrains Mono** with tabular figures. |
| Forbidden type | Inter, Roboto, Arial, Helvetica, system stacks, Space Grotesk. |
| Forbidden visuals | Purple-to-blue gradients, neon, default shadcn slate, glassmorphism. |
| Surfaces | Cream paper with 4% SVG noise overlay. Letterpress shadows, never large blurs. |
| Density | Generous whitespace; magazine-style asymmetric layouts on hero pages. |
| Motion | Staggered list reveals, ink-bleed underlines, ingredient stamp ticks. Respects `prefers-reduced-motion`. |

## Design tokens

The single source of truth lives in
`/home/user/dishton/src/styles/tokens.css`. Tailwind v4 picks them up via
`@theme`. A mirror module `src/ui/theme.ts` re-exports the same values for use in
Motion animations and JS-driven measurements.

```css
/* src/styles/tokens.css */
@theme {
  /* Type */
  --font-display: "Fraunces", "Iowan Old Style", Georgia, serif;
  --font-body: "General Sans", "Inter Fallback", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;
  --text-3xl: 2.25rem;
  --text-display: clamp(2.75rem, 6vw, 4.5rem);

  --leading-tight: 1.1;
  --leading-snug: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.7;

  /* Light palette */
  --color-paper: #f5efe3;        /* page background */
  --color-paper-2: #ece4d2;      /* card surface */
  --color-ink: #2a1a2c;          /* body text */
  --color-ink-soft: #4b3a4d;     /* secondary text */
  --color-ink-muted: #8b8276;    /* tertiary / hint */
  --color-saffron: #e08a1a;      /* primary accent */
  --color-saffron-ink: #5a3506;  /* on-saffron text */
  --color-sage: #5c7457;         /* secondary accent */
  --color-sage-ink: #1f2a1c;
  --color-aubergine: #5b2742;    /* deep accent for headers */
  --color-pomegranate: #b3304a;  /* destructive */
  --color-cream-line: #d8cfb8;   /* dividers */

  /* Spacing & radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 14px;
  --radius-pill: 999px;

  /* Shadows — letterpress, not big blurs */
  --shadow-press: 0 1px 0 rgba(0,0,0,.04), 0 8px 24px -12px rgba(42,26,44,.18);
  --shadow-press-lg: 0 1px 0 rgba(0,0,0,.05), 0 18px 36px -16px rgba(42,26,44,.24);
  --shadow-stamp: inset 0 0 0 1.5px var(--color-ink);

  /* Motion */
  --ease-paper: cubic-bezier(0.2, 0.7, 0.1, 1.05);
  --ease-stamp: cubic-bezier(0.4, 1.6, 0.6, 1);
  --duration-fast: 140ms;
  --duration-base: 240ms;
  --duration-slow: 420ms;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-paper:  #1a1614;
    --color-paper-2: #221c1a;
    --color-ink: #ece3d2;
    --color-ink-soft: #c8bfae;
    --color-ink-muted: #8a7f6f;
    --color-saffron: #f2a23c;
    --color-saffron-ink: #2a1a06;
    --color-sage: #8aa682;
    --color-sage-ink: #0e1410;
    --color-aubergine: #c08aa0;
    --color-pomegranate: #e8718a;
    --color-cream-line: #3b332e;
    --shadow-press: 0 1px 0 rgba(0,0,0,.4), 0 12px 28px -16px rgba(0,0,0,.6);
  }
}

@media (prefers-reduced-motion: reduce) {
  @theme {
    --duration-fast: 1ms;
    --duration-base: 1ms;
    --duration-slow: 1ms;
  }
}
```

```ts
// src/ui/theme.ts (kept in sync by hand; one-line tests assert parity)
export const theme = {
  duration: { fast: 140, base: 240, slow: 420 },
  ease:     { paper: [0.2, 0.7, 0.1, 1.05], stamp: [0.4, 1.6, 0.6, 1] },
  color:    {
    paper: 'var(--color-paper)',
    ink: 'var(--color-ink)',
    saffron: 'var(--color-saffron)',
    sage: 'var(--color-sage)',
    aubergine: 'var(--color-aubergine)',
  }
} as const;
```

## Accessibility floor (WCAG AA)

Every text/background pair below is verified to meet 4.5:1 (normal) or 3:1 (large).
If a future change breaks any pair, the change is wrong.

| Foreground | Background | Light ratio | Dark ratio | Use |
|---|---|---|---|---|
| `--color-ink` | `--color-paper` | 11.6:1 | — | body |
| `--color-ink` | `--color-paper-2` | 9.8:1 | — | cards |
| `--color-ink-soft` | `--color-paper` | 7.4:1 | — | secondary text |
| `--color-saffron-ink` | `--color-saffron` | 6.1:1 | 7.0:1 | accent buttons |
| `--color-sage-ink` | `--color-sage` | 8.0:1 | 9.1:1 | secondary buttons |
| `--color-paper` | `--color-aubergine` | 9.0:1 | — | header inversions |

Focus states: 2px solid `--color-saffron` outline + 2px offset, never removed.
Hit targets ≥ 40×40 px on touch devices.

## Font loading

```html
<!-- index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style"
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&display=swap">
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&display=swap">

<!-- General Sans + JetBrains Mono via Fontshare/self-host -->
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=general-sans@1,2&display=swap">
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap">
```

`font-display: swap` is mandatory. Subset is `latin` + `latin-ext` to cover EU
recipe sources.

## Surfaces

- `card` — background `--color-paper-2`, border `1px solid --color-cream-line`,
  shadow `--shadow-press`, radius `--radius-lg`. Optional 4% SVG noise overlay
  served from `/home/user/dishton/src/styles/paper-grain.svg`:

```html
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">
  <filter id="n">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
    <feColorMatrix type="matrix"
      values="0 0 0 0 0.16  0 0 0 0 0.10  0 0 0 0 0.17  0 0 0 0.04 0"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#n)"/>
</svg>
```

Apply via `background-image: url('/paper-grain.svg'); background-size: 220px;`
on the `body` element only — overlay propagates. Cards do not double-stack the
texture.

## Motion principles

- Stagger reveal on lists: 60ms per item, max 10 items animated, the rest snap in.
- Card hover: 1px translateY up, shadow swaps from `--shadow-press` to
  `--shadow-press-lg`, duration `--duration-fast`.
- Ingredient checkbox "stamp": scale 0.6 → 1.05 → 1.0 with `--ease-stamp`,
  rotate 0 → -3deg → 0, total 320ms. Tick mark drawn via SVG path length
  animation.
- Link underline: pseudo-element `::after`, `width: 0 → 100%`,
  `transform-origin: left`, `--duration-base` `--ease-paper`. On hover only.
- Page transition: 12px translateY + opacity 0 → 1, `--duration-base`. Skip for
  back-button navigation (use `popstate` detection).
- All durations collapse to 1ms when `prefers-reduced-motion: reduce`.

## Primitive component inventory

All primitives live in `/home/user/dishton/src/ui/primitives/`. Each ships with
a sibling `.test.tsx` (see [12-testing-strategy.md](./12-testing-strategy.md)).

| Component | Purpose | Notes |
|---|---|---|
| `Button` | Standard action | variants: `primary` (saffron), `secondary` (sage), `ghost`, `destructive` (pomegranate). Loading state shows a small ink-stroke spinner. |
| `IconButton` | Icon-only | uses lucide-react; minimum 40×40 hit target. |
| `Card` | Content container | letterpress shadow, optional `as="article"`. |
| `Input` | Text field | thick bottom border, no full box; saffron underline on focus. |
| `Textarea` | Multi-line | same border treatment. |
| `NumberInput` | Numeric | tabular figures, +/- steppers, accepts fractions ("1 1/2"). |
| `Checkbox` | Stamp checkbox | the cooking-mode ingredient tick. |
| `RadioGroup` | Single choice | row or column. |
| `Switch` | Boolean | sage-on. |
| `Select` | Dropdown | custom themed listbox (WAI-ARIA select-only combobox): button trigger + token-styled popup, so the option list matches the theme (incl. dark mode) instead of the OS-drawn native `<select>` popup. |
| `Combobox` | Searchable select | for tag picker. |
| `Slider` | Single thumb | the servings scaler. |
| `Badge` / `Tag` | Chip | tag list, status. |
| `Dialog` | Modal | radix-ui under the hood (`@radix-ui/react-dialog`), but heavily restyled. |
| `Drawer` | Side / bottom sheet | bottom on mobile, right on desktop; used for ingredient sidebar. |
| `Toast` | Snackbar | bottom-center, paper-on-aubergine inversion. |
| `Tooltip` | Hover hint | small body type. |
| `Tabs` | Section switch | underline indicator with ink-bleed motion. |
| `Avatar` | Profile / household | initials fallback in saffron. |
| `Skeleton` | Loading | low-contrast paper-2 stripes. |
| `EmptyState` | Zero data | display-type heading + soft illustration slot. |
| `ServingsScaler` | Composite | servings count + ratio readout + slider. |
| `UnitToggle` | Composite | metric / imperial pair, segmented. |
| `LanguageToggle` | Composite | flag-free; shows BCP-47 + native name. |
| `IngredientList` | Composite | renders parsed quantity, unit, and the rest as ingredient name. |

`@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `@radix-ui/react-slider` are the
only Radix packages allowed (they are unstyled, accessible primitives). Listed in
[02-tech-stack.md](./02-tech-stack.md) under "to add when first needed".

## Tailwind config (v4)

```ts
// vite.config.ts (excerpt)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwind()],
});
```

Tokens and themes are defined exclusively in `tokens.css` via `@theme`. Do not add
a `tailwind.config.{ts,js}` — v4 reads CSS-first.

Utility extensions:

- `font-display`, `font-body`, `font-mono` map to `--font-*`.
- `text-display` for hero titles.
- `bg-paper`, `bg-paper-2`, `text-ink`, etc. follow the variable names.
- `shadow-press`, `shadow-press-lg`.

## Directory layout (`src/ui/`)

```
src/ui/
  primitives/
    Button.tsx + Button.test.tsx
    Card.tsx + Card.test.tsx
    ...
    index.ts                (re-exports all primitives)
  recipe/
    RecipeCard.tsx          (list cell)
    RecipeDetail.tsx        (detail page composition)
    IngredientList.tsx
    StepList.tsx
    ServingsScaler.tsx
    UnitToggle.tsx
    LanguageToggle.tsx
    RecipeImportPanel.tsx   (the four-tab importer shell)
  household/
    HouseholdSwitcher.tsx
    InviteCodeCard.tsx
    FollowedHouseholdsList.tsx
  shell/
    AppShell.tsx            (layout, nav, topbar)
    NavBar.tsx
    EmptyState.tsx
  theme.ts                  (mirror of tokens for JS use)
```

## Iconography

`lucide-react` only. Import per icon, never the whole bundle. Stroke width 1.5
unless an icon looks anaemic at that weight (then 1.75). Icons inherit
`currentColor`.

## Files this doc governs

- `/home/user/dishton/src/styles/tokens.css`
- `/home/user/dishton/src/styles/paper-grain.svg`
- `/home/user/dishton/src/ui/theme.ts`
- `/home/user/dishton/src/ui/primitives/**`
- `/home/user/dishton/src/ui/recipe/**`
- `/home/user/dishton/src/ui/household/**`
- `/home/user/dishton/src/ui/shell/**`
- `/home/user/dishton/index.html` — font links above

## Acceptance criteria

- [ ] `tokens.css` defines every variable named in the tables above and is the
      only place those values appear.
- [ ] No file under `src/**` references `Inter`, `Roboto`, `system-ui` (without
      it being a fallback after our chosen fonts), `Arial`, or `Helvetica`.
- [ ] No file under `src/**` uses purple-blue gradients, glassmorphism, or
      `backdrop-filter: blur(...)`.
- [ ] All primitives expose a `className` prop merged with Tailwind classes via
      `tailwind-merge`.
- [ ] Every primitive is keyboard navigable and has a visible focus ring.
- [ ] `prefers-reduced-motion: reduce` collapses every duration to ≤ 1ms.
- [ ] Color-pair contrast is verified by a CI script
      `pnpm tsx scripts/check-contrast.ts` against the table above.
- [ ] `theme.ts` parity with `tokens.css` is checked by
      `pnpm test:unit` (a domain test asserts the values match).

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/03-design-system.md
grep -q "## Purpose"                docs/03-design-system.md
grep -q "## Prerequisites"          docs/03-design-system.md
grep -q "## Files this doc governs" docs/03-design-system.md
grep -q "## Acceptance criteria"    docs/03-design-system.md
grep -q "## Verification"           docs/03-design-system.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/03-design-system.md
# every promised token / font is referenced
for token in --color-paper --color-ink --color-saffron --color-sage \
             --color-aubergine --shadow-press --duration-base --ease-paper \
             Fraunces "General Sans" "JetBrains Mono"; do
  grep -q -- "$token" docs/03-design-system.md || echo "missing token: $token"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
