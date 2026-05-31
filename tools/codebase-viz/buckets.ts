// Maps a repo-relative source file path to the module node it belongs to.
// First match wins. Files that match nothing (tests, generated files, configs)
// return null and are excluded from the graph.
//
// The metadata for each module node (label, layer, kind, description) lives in
// MODULE_NODES so generate.ts can emit nodes even before any edge references
// them.

import type { Layer, NodeKind } from './types.ts';

interface BucketRule {
  prefix: string;
  id: string;
}

// Order matters: more specific prefixes must come before their parents.
const RULES: BucketRule[] = [
  { prefix: 'src/domain/', id: 'mod:domain' },
  { prefix: 'src/lib/queries/', id: 'mod:queries' },
  { prefix: 'src/lib/forms/', id: 'mod:forms' },
  { prefix: 'src/lib/imports/', id: 'mod:lib-imports' },
  { prefix: 'src/lib/', id: 'mod:lib-core' },
  { prefix: 'src/routes/', id: 'mod:routes' },
  { prefix: 'src/ui/primitives/', id: 'mod:ui-primitives' },
  { prefix: 'src/ui/recipe/', id: 'mod:ui-recipe' },
  { prefix: 'src/ui/household/', id: 'mod:ui-household' },
  { prefix: 'src/ui/search/', id: 'mod:ui-search' },
  { prefix: 'src/ui/shell/', id: 'mod:ui-shell' },
  { prefix: 'src/ui/', id: 'mod:ui-core' },
  { prefix: 'src/feature-flags/', id: 'mod:feature-flags' },
  { prefix: 'src/observability/', id: 'mod:observability' },
  { prefix: 'supabase/functions/_shared/ai/', id: 'mod:fn-shared-ai' },
  { prefix: 'supabase/functions/_shared/scrape/', id: 'mod:fn-shared-scrape' },
  { prefix: 'supabase/functions/_shared/', id: 'mod:fn-shared-core' },
  { prefix: 'supabase/functions/import-url/', id: 'fn:import-url' },
  { prefix: 'supabase/functions/import-instagram/', id: 'fn:import-instagram' },
  { prefix: 'supabase/functions/import-photo/', id: 'fn:import-photo' },
  { prefix: 'supabase/functions/translate-recipe/', id: 'fn:translate-recipe' },
];

export function bucketFor(repoRelPath: string): string | null {
  const normalized = repoRelPath.replaceAll('\\', '/');
  for (const rule of RULES) {
    if (normalized.startsWith(rule.prefix)) return rule.id;
  }
  return null;
}

export interface ModuleNodeDef {
  id: string;
  label: string;
  layer: Layer;
  kind: NodeKind;
  description: string;
}

// Curated metadata for every module node bucketFor() can produce. generate.ts
// only emits nodes that actually contain files, so unused buckets are dropped.
export const MODULE_NODES: ModuleNodeDef[] = [
  {
    id: 'mod:domain',
    label: 'domain',
    layer: 'browser',
    kind: 'module',
    description:
      'Zod schemas + pure business logic (recipe shape, units, scaling, language). No React, no I/O. Shared with Edge Functions via the _shared/domain symlink.',
  },
  {
    id: 'mod:queries',
    label: 'lib/queries',
    layer: 'browser',
    kind: 'module',
    description:
      'TanStack Query hooks wrapping supabase.from(...) / supabase.rpc(...) reads and mutations.',
  },
  {
    id: 'mod:forms',
    label: 'lib/forms',
    layer: 'browser',
    kind: 'module',
    description: 'react-hook-form + Zod input schemas for auth, household and import forms.',
  },
  {
    id: 'mod:lib-imports',
    label: 'lib/imports',
    layer: 'browser',
    kind: 'module',
    description:
      'ActiveImportsProvider: Realtime subscription to import_jobs, in-memory state of running imports, invokes the import Edge Functions.',
  },
  {
    id: 'mod:lib-core',
    label: 'lib (core)',
    layer: 'browser',
    kind: 'module',
    description:
      'Supabase client, Zustand auth store, i18n, photo-resize, PWA install — shared utilities.',
  },
  {
    id: 'mod:routes',
    label: 'routes',
    layer: 'browser',
    kind: 'module',
    description:
      'TanStack Router file-based pages: auth, onboarding, household, recipe detail/edit, search, profile.',
  },
  {
    id: 'mod:ui-primitives',
    label: 'ui/primitives',
    layer: 'browser',
    kind: 'module',
    description:
      'Radix + shadcn-style design primitives (Button, Dialog, Select, Slider, Toast, ...).',
  },
  {
    id: 'mod:ui-recipe',
    label: 'ui/recipe',
    layer: 'browser',
    kind: 'module',
    description:
      'Recipe-specific components: ingredients, servings scaler, unit/language toggles, tag picker.',
  },
  {
    id: 'mod:ui-household',
    label: 'ui/household',
    layer: 'browser',
    kind: 'module',
    description: 'Household management sections and dialogs (members, sharing, tags, invites).',
  },
  {
    id: 'mod:ui-search',
    label: 'ui/search',
    layer: 'browser',
    kind: 'module',
    description: 'Search bar and tag strip.',
  },
  {
    id: 'mod:ui-shell',
    label: 'ui/shell',
    layer: 'browser',
    kind: 'module',
    description: 'App shell, navigation and the active-imports indicator.',
  },
  {
    id: 'mod:ui-core',
    label: 'ui (core)',
    layer: 'browser',
    kind: 'module',
    description: 'Shared UI helpers (cn, theme).',
  },
  {
    id: 'mod:feature-flags',
    label: 'feature-flags',
    layer: 'browser',
    kind: 'module',
    description:
      'Runtime + build-time feature gates (google_auth, translation_cache, follows_enabled).',
  },
  {
    id: 'mod:observability',
    label: 'observability',
    layer: 'browser',
    kind: 'module',
    description: 'Sentry init and breadcrumb logging.',
  },
  {
    id: 'mod:fn-shared-ai',
    label: '_shared/ai',
    layer: 'edge',
    kind: 'module',
    description:
      'Anthropic client, prompt templates, tool schema, Zod validation wrapper and token-bucket rate budget. The only place that talks to the Anthropic API.',
  },
  {
    id: 'mod:fn-shared-scrape',
    label: '_shared/scrape',
    layer: 'edge',
    kind: 'module',
    description: 'JSON-LD recipe extraction and lightweight HTML stripping for the AI prompt.',
  },
  {
    id: 'mod:fn-shared-core',
    label: '_shared (core)',
    layer: 'edge',
    kind: 'module',
    description:
      'JWT auth / RLS-aware client, import-runner sync-vs-background detach, structured logging, env, the domain symlink.',
  },
  {
    id: 'fn:import-url',
    label: 'import-url',
    layer: 'edge',
    kind: 'function',
    description:
      'Paste a blog/article URL → JSON-LD scrape + HTML strip → Anthropic → validated draft Recipe + import_jobs row.',
  },
  {
    id: 'fn:import-instagram',
    label: 'import-instagram',
    layer: 'edge',
    kind: 'function',
    description:
      'Instagram URL → oEmbed (or OG fallback) caption + thumbnail → Anthropic → draft Recipe.',
  },
  {
    id: 'fn:import-photo',
    label: 'import-photo',
    layer: 'edge',
    kind: 'function',
    description:
      'Uploaded images in the imports bucket → short-lived signed URLs → Anthropic vision → draft Recipe.',
  },
  {
    id: 'fn:translate-recipe',
    label: 'translate-recipe',
    layer: 'edge',
    kind: 'function',
    description:
      'Translation cache lookup; on miss call Anthropic, validate, upsert recipe_translations, return payload.',
  },
];
