// AI mock mode. When env.AI_MOCK_MODE is set (e.g. '1' or 'playwright'),
// aiChat short-circuits to a canned fixture and makes NO network call to
// api.anthropic.com. This keeps e2e / local runs deterministic and free, and
// removes the need for a real ANTHROPIC_API_KEY in CI.
//
// The fixtures are embedded here (not read from e2e/fixtures/*.json) so the
// module is self-contained and bundles cleanly with the Edge Function — the
// e2e/ directory is not part of the deployed functions tree. They mirror
// e2e/fixtures/ai-draft.json and e2e/fixtures/ai-translation.de.json; keep
// them in sync if those change.
//
// AI_MOCK_MODE is never set in production. env.ts lists it as OPTIONAL and the
// deploy pipeline does not set it.

import type { AiCallOpts, AiResult } from './client.ts';

// Read AI_MOCK_MODE directly from the environment rather than through the
// cached env proxy, so toggling it at runtime (tests) takes effect immediately.
function readMockEnv(): string | undefined {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  if (d && typeof d.env?.get === 'function') return d.env.get('AI_MOCK_MODE') ?? undefined;
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    ?.AI_MOCK_MODE;
}

export function isMockMode(): boolean {
  const v = readMockEnv();
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

// Mirrors e2e/fixtures/ai-draft.json.
const DRAFT_FIXTURE = {
  title: 'Tomato Tarte Tatin',
  description: 'A savoury riff on the classic, baked upside-down with caramelised tomatoes.',
  source_type: 'url',
  source_url: 'https://example.test/tomato-tarte-tatin',
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 55,
  hero_image_path: null,
  tags: ['vegetarian', 'tarte', 'summer'],
  ingredients: [
    { position: 0, raw_text: '500 g tomatoes', quantity: 500, unit: 'g', ingredient_name: 'tomatoes', notes: null, scalable: true, non_scalable_qty: null },
    { position: 1, raw_text: '30 g caster sugar', quantity: 30, unit: 'g', ingredient_name: 'caster sugar', notes: null, scalable: true, non_scalable_qty: null },
    { position: 2, raw_text: '1 sheet puff pastry', quantity: 1, unit: 'count', ingredient_name: 'puff pastry', notes: null, scalable: true, non_scalable_qty: null },
    { position: 3, raw_text: 'salt to taste', quantity: null, unit: null, ingredient_name: 'salt', notes: null, scalable: false, non_scalable_qty: 'to_taste' },
  ],
  steps: [
    { position: 0, body: 'Preheat the oven to 180 C.', duration_min: 5 },
    { position: 1, body: 'Caramelise the sugar in an oven-proof skillet.', duration_min: 8 },
    { position: 2, body: 'Arrange the tomatoes cut-side down, season.', duration_min: 5 },
    { position: 3, body: 'Drape the puff pastry over the top, tuck in.', duration_min: 3 },
    { position: 4, body: 'Bake until golden, then invert onto a plate.', duration_min: 30 },
  ],
} as const;

// Mirrors e2e/fixtures/ai-translation.de.json.
const TRANSLATION_DE_FIXTURE = {
  title: 'Tomaten-Tarte-Tatin',
  description: 'Eine herzhafte Variante des Klassikers, kopfüber mit karamellisierten Tomaten gebacken.',
  source_type: 'url',
  source_url: 'https://example.test/tomato-tarte-tatin',
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 55,
  hero_image_path: null,
  tags: ['vegetarisch', 'tarte', 'sommer'],
  ingredients: [
    { position: 0, raw_text: '500 g Tomaten', quantity: 500, unit: 'g', ingredient_name: 'Tomaten', notes: null, scalable: true, non_scalable_qty: null },
    { position: 1, raw_text: '30 g Streuzucker', quantity: 30, unit: 'g', ingredient_name: 'Streuzucker', notes: null, scalable: true, non_scalable_qty: null },
    { position: 2, raw_text: '1 Blatt Blätterteig', quantity: 1, unit: 'count', ingredient_name: 'Blätterteig', notes: null, scalable: true, non_scalable_qty: null },
    { position: 3, raw_text: 'Salz nach Geschmack', quantity: null, unit: null, ingredient_name: 'Salz', notes: null, scalable: false, non_scalable_qty: 'to_taste' },
  ],
  steps: [
    { position: 0, body: 'Den Ofen auf 180 C vorheizen.', duration_min: 5 },
    { position: 1, body: 'Den Zucker in einer ofenfesten Pfanne karamellisieren.', duration_min: 8 },
    { position: 2, body: 'Die Tomaten mit der Schnittseite nach unten anrichten, würzen.', duration_min: 5 },
    { position: 3, body: 'Den Blätterteig darüber legen und einschlagen.', duration_min: 3 },
    { position: 4, body: 'Goldbraun backen, dann auf einen Teller stürzen.', duration_min: 30 },
  ],
} as const;

function systemText(opts: AiCallOpts): string {
  return opts.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')))
    .join(' ')
    .toLowerCase();
}

// Pick the right fixture for the call. Translation calls carry the distinctive
// translate-recipe system preamble; the structuring prompt also mentions the
// word "translate" (unit-word handling + language directive), so match the
// translate prompt's unique opening phrase rather than a bare substring.
export function mockAiChat(opts: AiCallOpts): AiResult {
  const isTranslate = systemText(opts).includes('you translate a dishton recipe');
  const fixture = isTranslate ? TRANSLATION_DE_FIXTURE : DRAFT_FIXTURE;
  return {
    content: JSON.stringify(fixture),
    tool_input: fixture,
    usage: { input: 0, output: 0 },
    model: 'mock',
  };
}
