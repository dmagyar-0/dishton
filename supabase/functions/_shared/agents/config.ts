// Static, version-controlled definition of the Recipe Drafter agent. Imported
// by the one-time setup script (scripts/managed-agents/setup.ts). The webhook
// validates drafts against the Recipe Zod schema directly, so it does not need
// these tool schemas at runtime — they exist here so the agent's capabilities
// live in one reviewable place.

export const RECIPE_AGENT_MODEL = 'claude-sonnet-4-6';
export const RECIPE_AGENT_EFFORT = 'medium';
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

export const RECIPE_AGENT_SYSTEM = `You are Dishton's recipe drafter — a collaborative cook who turns a vibe and optional ingredients into a single, well-tested recipe.

Workflow:
1. Understand the request. Ask a brief clarifying question ONLY when the request is genuinely ambiguous; otherwise proceed.
2. Call list_my_recipes early to learn the household's taste (cuisines, ingredients, units, language). Use get_recipe only to drill into a specific recipe the user references.
3. Use web_search sparingly (1-2 searches) for technique, ratios, or inspiration — not for every turn.
4. Produce a complete draft by calling present_draft with a full recipe. Match the household's prevailing unit system and language. Set source_type to "manual". For tags, choose only from the household's allowed tag list (provided in the user message), exactly as written — never invent new tags; omit a tag rather than make one up.
5. Explain the draft in one short message, then iterate on the user's feedback by calling present_draft again.

Never save the recipe — the human clicks "Save to pantry". Keep responses concise.`;

export const LIST_MY_RECIPES_TOOL = {
  type: 'custom',
  name: 'list_my_recipes',
  description:
    "List the household's existing recipes (compact: titles, tags, key ingredients, unit system, language) to learn its taste. Omits full steps.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional keyword filter on title.' },
      limit: { type: 'integer', description: 'Max recipes to return (default 50).' },
    },
    required: [],
  },
} as const;

export const GET_RECIPE_TOOL = {
  type: 'custom',
  name: 'get_recipe',
  description: 'Fetch one full recipe (ingredients + steps) by id, for drill-down.',
  input_schema: {
    type: 'object',
    properties: { recipe_id: { type: 'string' } },
    required: ['recipe_id'],
  },
} as const;

// Mirrors the existing extract_recipe tool shape (hardcoded for model
// reliability). Validation against the Recipe Zod schema is the source of truth.
export const PRESENT_DRAFT_TOOL = {
  type: 'custom',
  name: 'present_draft',
  description:
    'Present the current recipe draft to the user. Call this whenever you have a new or revised draft. The full recipe object is required.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: ['string', 'null'] },
      source_type: { type: 'string', enum: ['manual'] },
      source_url: { type: ['string', 'null'] },
      source_language: { type: 'string', description: 'BCP-47, e.g. "en".' },
      canonical_unit_system: { type: 'string', enum: ['metric', 'imperial'] },
      servings: { type: 'integer' },
      total_time_min: { type: ['integer', 'null'] },
      hero_image_path: { type: ['string', 'null'] },
      tags: { type: 'array', items: { type: 'string' } },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer' },
            raw_text: { type: 'string' },
            quantity: {},
            unit: { type: ['string', 'null'] },
            ingredient_name: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            scalable: { type: 'boolean' },
            non_scalable_qty: { type: ['string', 'null'] },
            section: { type: ['string', 'null'] },
          },
          required: ['position', 'raw_text'],
        },
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer' },
            body: { type: 'string' },
            duration_min: { type: ['integer', 'null'] },
          },
          required: ['position', 'body'],
        },
      },
    },
    required: ['title', 'canonical_unit_system', 'servings', 'ingredients', 'steps'],
  },
} as const;

export const RECIPE_AGENT_TOOLS = [
  {
    type: 'agent_toolset_20260401',
    default_config: { enabled: false },
    configs: [
      { name: 'web_search', enabled: true },
      { name: 'web_fetch', enabled: true },
    ],
  },
  LIST_MY_RECIPES_TOOL,
  GET_RECIPE_TOOL,
  PRESENT_DRAFT_TOOL,
];
