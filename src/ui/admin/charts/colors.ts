// Chart color choices for /admin/metrics, built ONLY from Dishton's existing
// design tokens (tokens.css / src/ui/theme.ts) -- CLAUDE.md freezes the
// design tokens as a contract, and the task deliberately forbids a new chart
// dependency, so this file introduces zero new hex values.
//
// Dishton's "Soft Contrast" tokens are a low-chroma, print-style (risograph)
// palette, not a data-viz categorical ramp. Running the `dataviz` skill's
// validator (scripts/validate_palette.js) against the obvious 5-6 hue
// categorical candidates FAILS the OKLCH chroma-floor check for most of them
// (sage C=0.051, aubergine C=0.047, ink-soft C=0.042 -- all well under the
// 0.10 floor the checks require to read as a hue rather than gray). Only
// pomegranate, saffron, terracotta and accent-ink clear the floor, and
// saffron/terracotta/accent-ink all sit in the same orange hue family
// (H 51-66deg), so a "pick your favourite five tokens" categorical palette
// cannot pass the CVD-separation checks with this token set.
//
// Rather than invent new brand hues to satisfy the validator (which would
// break the frozen-tokens contract), every chart here is deliberately kept
// to AT MOST two simultaneous colors, chosen from pairs that DO pass:
//
//   accent/context (emphasis)  saffron vs ink-soft   deltaE 30.0 normal / 26.9 protan -- PASS
//   good/bad (status)          sage    vs pomegranate deltaE 25.6 normal / 14.4 deutan -- PASS
//   ordinal (DAU/WAU/MAU)      aubergine, 3 opacity steps -- validate_palette.js --ordinal: PASS
//
// Anything with more identities than that (import kind, AI model, edge-call
// outcome) is rendered as a table instead of a many-hue chart -- the
// dataviz skill's own guidance for ">7 classes that all carry meaning", used
// here at a lower threshold because the palette itself cannot carry more.
// Single-series magnitude marks (import volume, AI cost) need no adjacency
// check at all, only a >=3:1 WCAG contrast against the paper surface:
// aubergine 9.8:1, terracotta 3.5:1 -- both clear it standalone.

import { theme } from '@/ui/theme';

export const CHART_COLORS = {
  // Single-hue magnitude marks (one series each -- no CVD adjacency to check).
  volume: theme.color.aubergine,
  cost: theme.color.terracotta,

  // Ordinal ramp for DAU/WAU/MAU: one hue, monotone lightness via opacity.
  // Darkest/most-opaque = the shortest (most current) window.
  ordinal: theme.color.aubergine,
  ordinalOpacity: [1, 0.55, 0.32] as const,

  // Emphasis pair: the metric that matters (accent) vs. everything else
  // (context, de-emphasised). Validated CVD pass -- see file header.
  accent: theme.color.saffron,
  context: theme.color.inkSoft,

  // Status pair: good vs. bad. Validated CVD pass -- see file header. Always
  // paired with an icon + text label per the dataviz skill's status rule,
  // never color alone.
  good: theme.color.sage,
  bad: theme.color.pomegranate,

  // Chart chrome -- never carries identity.
  grid: theme.color.creamLine,
  axisText: theme.color.inkSoft,
  surface: theme.color.paper2,
} as const;
