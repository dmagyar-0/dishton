// Anthropic tool-use definition for recipe structuring. The model is forced
// to call `extract_recipe` with a Recipe-shaped argument, replacing the older
// "return JSON inside a text block" contract.
//
// The schema below is hand-rolled (not derived from Zod) so we can tune it
// for the model — descriptions, enums, and nullability matter to tool-call
// reliability. The parity test in `_test.ts` walks the canonical Zod Recipe
// shape and asserts every field name appears here, catching drift when a new
// Recipe field is added.

import type Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';

const quantitySchema = {
  description: 'Numeric amount, fraction object, or null when not applicable.',
  oneOf: [
    { type: 'number' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['numerator', 'denominator'],
      properties: {
        numerator: { type: 'integer', minimum: 0 },
        denominator: { type: 'integer', minimum: 1 },
      },
    },
    { type: 'null' },
  ],
} as const;

const ingredientSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'position',
    'raw_text',
    'quantity',
    'unit',
    'ingredient_name',
    'notes',
    'scalable',
    'non_scalable_qty',
    'section',
  ],
  properties: {
    position: { type: 'integer', minimum: 0, description: '0-indexed, contiguous.' },
    raw_text: { type: 'string', minLength: 1 },
    quantity: quantitySchema,
    unit: { type: ['string', 'null'] },
    ingredient_name: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    scalable: { type: 'boolean' },
    non_scalable_qty: {
      type: ['string', 'null'],
      enum: ['to_taste', 'pinch', 'dash', 'splash', 'handful', 'optional', null],
    },
    section: {
      type: ['string', 'null'],
      description: 'Sub-heading the ingredient belongs to (e.g. "For the sauce"), or null.',
    },
  },
} as const;

const stepSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['position', 'body', 'duration_min'],
  properties: {
    position: { type: 'integer', minimum: 0, description: '0-indexed, contiguous.' },
    body: { type: 'string', minLength: 1 },
    duration_min: { type: ['integer', 'null'], minimum: 0 },
  },
} as const;

export const EXTRACT_RECIPE_TOOL = {
  name: 'extract_recipe',
  description:
    'Return the parsed recipe in Dishton canonical shape. Call this exactly once with the full recipe object.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'description',
      'source_type',
      'source_url',
      'source_language',
      'canonical_unit_system',
      'servings',
      'total_time_min',
      'hero_image_path',
      'tags',
      'ingredients',
      'steps',
    ],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      source_type: { type: 'string', enum: ['url', 'instagram', 'photo', 'manual'] },
      source_url: { type: ['string', 'null'] },
      source_language: {
        type: 'string',
        description: 'BCP-47 code, e.g. "en", "hu", "de-DE".',
      },
      canonical_unit_system: { type: 'string', enum: ['metric', 'imperial'] },
      servings: { type: 'integer', minimum: 1, maximum: 200 },
      total_time_min: { type: ['integer', 'null'], minimum: 0 },
      hero_image_path: { type: ['string', 'null'] },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 40 },
        description: 'Subset of the household-defined whitelist, exactly as written.',
      },
      ingredients: { type: 'array', items: ingredientSchema },
      steps: { type: 'array', items: stepSchema },
    },
  },
} as const satisfies Anthropic.Tool;
