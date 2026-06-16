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

// Mirrors e2e/fixtures/ai-translation.de.json. source_language is the TARGET
// (de): a translation rewrites the recipe into the importer's language and
// stores it under that language — see translateExtractedRecipe in prompts.ts.
const TRANSLATION_DE_FIXTURE = {
  title: 'Tomaten-Tarte-Tatin',
  description: 'Eine herzhafte Variante des Klassikers, kopfüber mit karamellisierten Tomaten gebacken.',
  source_type: 'url',
  source_url: 'https://example.test/tomato-tarte-tatin',
  source_language: 'de',
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

// Pull the BCP-47 target out of a translation system prompt. Both translate
// prompts phrase the destination as "...translate ... into <code>." systemText
// has already lowercased the prompt, so re-uppercase any region subtag to keep
// the result a valid BCP-47 tag (the Recipe schema's source_language requires
// it). Returns null when no target is found.
function translationTarget(systemLower: string): string | null {
  const m = systemLower.match(/\binto ([a-z]{2})(-[a-z]{2})?\b/);
  if (!m) return null;
  return m[2] ? `${m[1]}${m[2].toUpperCase()}` : (m[1] ?? null);
}

// Read the recipe JSON out of the last user turn. Both translation prompts put
// the recipe there (translateExtractedRecipe stringifies the parsed recipe;
// translatePrompt passes recipeJson), so the mock can echo it back with the
// language flipped for targets we have no canned translation for.
function lastUserRecipe(opts: AiCallOpts): Record<string, unknown> | null {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (!m || m.role !== 'user') continue;
    const text = typeof m.content === 'string'
      ? m.content
      : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Pick the right fixture for the call. Both the import-path tool-mode
// translation (translateExtractedRecipe — "You translate an already-parsed
// recipe into …") and the display-path text-mode translation (translatePrompt
// — "You translate a Dishton Recipe JSON into …") open with "you translate ".
// The structuring prompts never do (they "convert"/"read" and only mention
// translating *unit words*), so this prefix cleanly tells a translation call
// apart from a structuring call — including the import-path translation that an
// earlier, narrower match ("you translate a dishton recipe") missed, which made
// every non-English import come back untranslated in mock mode.
export function mockAiChat(opts: AiCallOpts): AiResult {
  const sys = systemText(opts);
  let fixture: Record<string, unknown>;
  if (sys.includes('you translate ')) {
    const target = translationTarget(sys) ?? 'en';
    // The mock can't truly translate arbitrary languages. For German we have
    // hand-written translated copy (so visual checks see real German); for any
    // other target we echo the source recipe and flip the stored language,
    // which is the user-visible contract the importer promises — the recipe
    // lands in the user's language (source_language = target).
    const body = target.toLowerCase().startsWith('de')
      ? TRANSLATION_DE_FIXTURE
      : (lastUserRecipe(opts) ?? DRAFT_FIXTURE);
    fixture = { ...body, source_language: target };
  } else {
    fixture = { ...DRAFT_FIXTURE };
  }
  return {
    content: JSON.stringify(fixture),
    tool_input: fixture,
    usage: { input: 0, output: 0 },
    model: 'mock',
  };
}
