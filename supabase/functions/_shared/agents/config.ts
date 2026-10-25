// Static, version-controlled definition of the Recipe Drafter agent. Imported
// by the control-plane scripts (scripts/managed-agents/setup.ts and update.ts). The webhook
// validates drafts against the Recipe Zod schema directly, so it does not need
// these tool schemas at runtime — they exist here so the agent's capabilities
// live in one reviewable place.

export const RECIPE_AGENT_MODEL = 'claude-haiku-5-5';
export const RECIPE_AGENT_EFFORT = 'medium';
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

// Managed Agents takes effort on the agent's model object, not as a separate
// field. Sent by both setup.ts (create) and update.ts (in-place update).
export const RECIPE_AGENT_MODEL_CONFIG = {
  id: RECIPE_AGENT_MODEL,
  effort: RECIPE_AGENT_EFFORT,
} as const;

export const RECIPE_AGENT_NAME = 'Dishton Recipe Drafter';
export const RECIPE_ENV_NAME_PREFIX = 'dishton-recipe-drafter-';

// web_search obeys the environment's networking: under `limited` with no
// allowed_hosts it returns no results at all. Recipe sources can't be listed
// up front, so the environment is unrestricted. That widens only the session
// container's egress, and the drafter has no sandbox tools (bash, files) to
// use it — default_config below disables the whole toolset but web_search.
export const RECIPE_ENV_CONFIG = {
  type: 'cloud',
  networking: { type: 'unrestricted' },
} as const;

export const RECIPE_AGENT_SYSTEM = `You are Dishton's recipe drafter — a collaborative cook who turns a vibe and optional ingredients into a single, well-tested recipe.

The first user message starts with the household's allowed tag list and a compact summary of its existing recipes (titles, tags, key ingredients, unit system, language). Use that summary to learn the household's taste.

Workflow:
1. Ask a brief clarifying question ONLY when the request is genuinely ambiguous; otherwise proceed.
2. Start your reply with one short sentence saying what you're going to make, so the cook sees something right away.
3. Rely on your own cooking knowledge. Use web_search only when the user asks for it or the dish is one you genuinely don't know well — never as a routine step. Call get_recipe only to drill into a specific recipe the user references; call list_my_recipes only if the summary is missing or the user asks about recipes it doesn't cover.
4. Write a short explanation of the draft (2-3 sentences: the idea, key choices), THEN call present_draft once with the full recipe. Match the household's prevailing unit system and language. Set source_type to "manual". For tags, choose only from the household's allowed tag list, exactly as written — never invent new tags; omit a tag rather than make one up.
5. When present_draft returns ok, end your turn without writing anything more. If it returns errors, fix them and call present_draft again.
6. On feedback, reply with one short sentence about the change, then call present_draft again with the revised recipe.

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
      // Optional, prompt-gated (see RECIPE_AGENT_SYSTEM). web_fetch stays off:
      // the drafter never needs to read a whole page.
      { name: 'web_search', enabled: true },
      { name: 'web_fetch', enabled: false },
    ],
  },
  LIST_MY_RECIPES_TOOL,
  GET_RECIPE_TOOL,
  PRESENT_DRAFT_TOOL,
];
