// schema v1
// Single source of truth for the canonical Recipe shape. Imported by the SPA
// directly and by Edge Functions via the `_shared/domain` symlink.

import { z } from 'zod';

export const Quantity = z.union([
  z.number().finite(),
  z.object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
  }),
]);
export type Quantity = z.infer<typeof Quantity>;

export const UnitSystem = z.enum(['metric', 'imperial']);
export type UnitSystem = z.infer<typeof UnitSystem>;

export const Bcp47 = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export type Bcp47 = z.infer<typeof Bcp47>;

export const NonScalableQty = z.enum([
  'to_taste',
  'pinch',
  'dash',
  'splash',
  'handful',
  'optional',
]);
export type NonScalableQty = z.infer<typeof NonScalableQty>;

export const SourceType = z.enum(['url', 'instagram', 'photo', 'manual']);
export type SourceType = z.infer<typeof SourceType>;

export const Ingredient = z.object({
  position: z.number().int().nonnegative(),
  raw_text: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: z.string().nullable(),
  ingredient_name: z.string().nullable(),
  notes: z.string().nullable(),
  scalable: z.boolean().default(true),
  non_scalable_qty: NonScalableQty.nullable().default(null),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Step = z.object({
  position: z.number().int().nonnegative(),
  body: z.string().min(1),
  duration_min: z.number().int().nonnegative().nullable(),
});
export type Step = z.infer<typeof Step>;

export const RecipeMeta = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  source_type: SourceType,
  source_url: z.string().url().nullable(),
  source_language: Bcp47.default('en'),
  canonical_unit_system: UnitSystem,
  servings: z.number().int().min(1).max(200),
  total_time_min: z.number().int().nonnegative().nullable(),
  hero_image_path: z.string().nullable(),
  tags: z.array(z.string().min(1).max(40)).default([]),
});
export type RecipeMeta = z.infer<typeof RecipeMeta>;

export const Recipe = RecipeMeta.extend({
  ingredients: z.array(Ingredient),
  steps: z.array(Step),
});
export type Recipe = z.infer<typeof Recipe>;
