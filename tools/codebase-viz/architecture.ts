// Hand-curated architecture layer. This is the half of the "hybrid" map that the
// import graph cannot see: the layered skeleton, external systems, the cross-
// boundary data flows (what data is sent), the Edge Function request/response
// payloads, the domain Zod shapes and the Postgres tables + RLS.
//
// Sources of truth — keep this in sync when they change:
//   - domain shapes: src/domain/recipe.ts
//   - payloads:      supabase/functions/*/index.ts (Body schema + jsonResponse)
//   - db tables/RLS: docs/04-data-model.md and supabase/migrations/

import type { DbTable, DomainShape, FnPayload, VizEdge, VizLayer, VizNode } from './types.ts';

export const LAYERS: VizLayer[] = [
  { id: 'browser', label: 'Browser · React SPA', order: 0 },
  { id: 'edge', label: 'Supabase Edge Functions · Deno', order: 1 },
  { id: 'postgres', label: 'Supabase Postgres', order: 2 },
  { id: 'external', label: 'External services', order: 3 },
];

// Curated nodes that have no source files of their own.
export const EXTERNAL_NODES: VizNode[] = [
  {
    id: 'db:tables',
    label: 'Postgres (app schema)',
    layer: 'postgres',
    kind: 'db',
    description:
      'Recipes and children, households + members, follows, import_jobs, translation cache and rate budget — all gated by Row Level Security.',
    files: [],
  },
  {
    id: 'ext:anthropic',
    label: 'Anthropic API',
    layer: 'external',
    kind: 'external',
    description:
      'claude-haiku-4-5 (text + vision, 200K context). Reached only from _shared/ai. Structured output is forced via the extract_recipe tool and validated against the Recipe Zod schema.',
    files: [],
  },
  {
    id: 'ext:auth',
    label: 'Supabase Auth (GoTrue)',
    layer: 'external',
    kind: 'external',
    description:
      'Email/password (+ feature-flagged Google OAuth). Issues the JWT carried on every request.',
    files: [],
  },
  {
    id: 'ext:storage',
    label: 'Supabase Storage',
    layer: 'external',
    kind: 'external',
    description:
      'imports bucket (uploaded photos) and recipe-images bucket. Edge Functions read uploads via short-lived signed URLs.',
    files: [],
  },
  {
    id: 'ext:oembed',
    label: 'Instagram oEmbed',
    layer: 'external',
    kind: 'external',
    description:
      'graph.facebook.com instagram_oembed endpoint for caption + thumbnail, with an Open Graph fallback chain.',
    files: [],
  },
];

// Per-function request/response payloads — what crosses the browser↔edge boundary.
export const PAYLOADS: Record<string, FnPayload> = {
  'fn:import-url': {
    request: { url: 'string (url)', household_id: 'string (uuid)' },
    responses: [
      {
        status: 200,
        shape: {
          job_id: 'uuid',
          draft: 'Recipe | null',
          needs_review: 'boolean',
          reason: 'string?',
          request_id: 'uuid',
        },
        note: 'Synchronous result. draft is null + needs_review true when the model output failed to parse/validate.',
      },
      {
        status: 202,
        shape: { job_id: 'uuid', status: "'running'", request_id: 'uuid' },
        note: 'Background detach — work continues; the SPA listens on import_jobs via Realtime.',
      },
      {
        status: 429,
        shape: { error: "'rate_limit'", retry_after: 60, request_id: 'uuid' },
        note: 'Token-bucket budget exhausted.',
      },
    ],
  },
  'fn:import-instagram': {
    request: { url: 'string (url)', household_id: 'string (uuid)' },
    responses: [
      {
        status: 200,
        shape: {
          job_id: 'uuid',
          draft: 'Recipe | null',
          needs_review: 'boolean',
          thumbnail_url: 'string?',
          request_id: 'uuid',
        },
      },
      { status: 202, shape: { job_id: 'uuid', status: "'running'", request_id: 'uuid' } },
      {
        status: 422,
        shape: { error: "'instagram_unavailable'" },
        note: 'Caption could not be fetched.',
      },
      { status: 429, shape: { error: "'rate_limit'", retry_after: 60, request_id: 'uuid' } },
    ],
  },
  'fn:import-photo': {
    request: {
      job_id: 'string (uuid)?',
      household_id: 'string (uuid)',
      paths: 'string[] (1..6 storage paths)',
      comment: 'string (<=500)?',
    },
    responses: [
      {
        status: 200,
        shape: {
          job_id: 'uuid',
          draft: 'Recipe | null',
          needs_review: 'boolean',
          request_id: 'uuid',
        },
      },
      { status: 202, shape: { job_id: 'uuid', status: "'running'", request_id: 'uuid' } },
      { status: 429, shape: { error: "'rate_limit'", retry_after: 60, request_id: 'uuid' } },
    ],
  },
  'fn:translate-recipe': {
    request: { recipe_id: 'string (uuid)', language: 'string (bcp47)' },
    responses: [
      {
        status: 200,
        shape: { payload: 'Recipe', cached: 'boolean', request_id: 'uuid' },
        note: 'cached true on translation-cache hit; false when freshly translated or language === source.',
      },
      { status: 429, shape: { error: "'rate_limit'", retry_after: 60, request_id: 'uuid' } },
      {
        status: 502,
        shape: { error: "'translation_failed'", reason: 'string', request_id: 'uuid' },
      },
    ],
  },
};

// Summaries of the Zod shapes in src/domain/recipe.ts (the data that is sent).
export const DOMAIN_SHAPES: DomainShape[] = [
  {
    name: 'Recipe',
    summary:
      'RecipeMeta + ingredients: Ingredient[] + steps: Step[]. The canonical recipe contract shared by SPA and Edge Functions.',
  },
  {
    name: 'RecipeMeta',
    summary:
      'title, description, source_type, source_url, source_language (bcp47, default "en"), canonical_unit_system, servings (1..200), total_time_min, hero_image_path, tags: string[].',
  },
  {
    name: 'Ingredient',
    summary:
      'position, raw_text, quantity: Quantity | null, unit, ingredient_name, notes, scalable (default true), non_scalable_qty, section.',
  },
  { name: 'Step', summary: 'position, body, duration_min: number | null.' },
  {
    name: 'Quantity',
    summary: 'number | { numerator, denominator } — exact fractions are preserved.',
  },
  { name: 'UnitSystem', summary: "enum 'metric' | 'imperial'." },
  { name: 'SourceType', summary: "enum 'url' | 'instagram' | 'photo' | 'manual'." },
  {
    name: 'NonScalableQty',
    summary: "enum 'to_taste' | 'pinch' | 'dash' | 'splash' | 'handful' | 'optional'.",
  },
];

// Postgres tables + one-line RLS summary (docs/04-data-model.md).
export const DB_TABLES: DbTable[] = [
  {
    name: 'profiles',
    columns: [
      'id',
      'display_name',
      'avatar_url',
      'locale',
      'preferred_unit_system',
      'preferred_language',
    ],
    rls: 'Self read/write (id = auth.uid()).',
  },
  {
    name: 'households',
    columns: ['id', 'name', 'owner_profile_id', 'is_personal'],
    rls: 'Member or follower read; owner write.',
  },
  {
    name: 'household_members',
    columns: ['household_id', 'profile_id', 'role'],
    rls: "Members read; owner manages roles ('owner' | 'editor').",
  },
  {
    name: 'follows',
    columns: ['follower_household_id', 'target_household_id'],
    rls: 'Members of the follower household read/write.',
  },
  {
    name: 'recipes',
    columns: [
      'id',
      'household_id',
      'title',
      'description',
      'source_type',
      'source_language',
      'canonical_unit_system',
      'servings',
      'total_time_min',
      'hero_image_path',
      'search (tsvector)',
    ],
    rls: 'Member or follower read; member with owner/editor role write.',
  },
  {
    name: 'recipe_ingredients',
    columns: [
      'id',
      'recipe_id',
      'position',
      'raw_text',
      'quantity',
      'unit',
      'ingredient_name',
      'notes',
      'section',
    ],
    rls: 'Inherits recipe access via household membership.',
  },
  {
    name: 'recipe_steps',
    columns: ['id', 'recipe_id', 'position', 'body', 'duration_min'],
    rls: 'Inherits recipe access via household membership.',
  },
  {
    name: 'recipe_tags',
    columns: ['recipe_id', 'tag'],
    rls: 'Inherits recipe access via household membership.',
  },
  {
    name: 'recipe_translations',
    columns: ['recipe_id', 'language', 'payload (jsonb)', 'source_hash'],
    rls: 'Member/follower read; service_role write (Edge Function cache).',
  },
  {
    name: 'import_jobs',
    columns: [
      'id',
      'profile_id',
      'household_id',
      'kind',
      'status',
      'phase',
      'progress_text',
      'payload (jsonb)',
      'error',
    ],
    rls: 'Self only (profile_id = auth.uid()).',
  },
  {
    name: 'ai_rate_budget',
    columns: ['tokens_used', 'budget_per_minute'],
    rls: 'service_role only (token bucket).',
  },
  { name: 'feature_flags', columns: ['flag_name', 'enabled'], rls: 'Read by authenticated users.' },
];

// Cross-boundary data-flow edges the import graph cannot see. label = data sent.
export const FLOW_EDGES: VizEdge[] = [
  { from: 'mod:lib-core', to: 'ext:auth', kind: 'flow', label: 'sign in → JWT' },
  { from: 'mod:queries', to: 'db:tables', kind: 'flow', label: 'supabase.from / .rpc (RLS-gated)' },
  { from: 'mod:lib-imports', to: 'db:tables', kind: 'flow', label: 'Realtime: import_jobs' },
  {
    from: 'mod:lib-imports',
    to: 'fn:import-url',
    kind: 'flow',
    label: 'POST { url, household_id }',
  },
  {
    from: 'mod:lib-imports',
    to: 'fn:import-instagram',
    kind: 'flow',
    label: 'POST { url, household_id }',
  },
  {
    from: 'mod:lib-imports',
    to: 'fn:import-photo',
    kind: 'flow',
    label: 'POST { paths[], household_id }',
  },
  {
    from: 'mod:queries',
    to: 'fn:translate-recipe',
    kind: 'flow',
    label: 'POST { recipe_id, language }',
  },
  { from: 'fn:import-url', to: 'db:tables', kind: 'flow', label: 'insert/update import_jobs' },
  {
    from: 'fn:import-instagram',
    to: 'db:tables',
    kind: 'flow',
    label: 'insert/update import_jobs',
  },
  { from: 'fn:import-photo', to: 'db:tables', kind: 'flow', label: 'insert/update import_jobs' },
  {
    from: 'fn:translate-recipe',
    to: 'db:tables',
    kind: 'flow',
    label: 'read recipe · upsert translation cache',
  },
  {
    from: 'fn:import-url',
    to: 'ext:anthropic',
    kind: 'flow',
    label: 'structuring prompt + extract_recipe tool',
  },
  {
    from: 'fn:import-instagram',
    to: 'ext:anthropic',
    kind: 'flow',
    label: 'caption → structuring prompt',
  },
  { from: 'fn:import-photo', to: 'ext:anthropic', kind: 'flow', label: 'vision prompt (images)' },
  { from: 'fn:translate-recipe', to: 'ext:anthropic', kind: 'flow', label: 'translation prompt' },
  {
    from: 'fn:import-photo',
    to: 'ext:storage',
    kind: 'flow',
    label: 'signed URL read (imports bucket)',
  },
  {
    from: 'fn:import-instagram',
    to: 'ext:oembed',
    kind: 'flow',
    label: 'oEmbed: caption + thumbnail',
  },
];
