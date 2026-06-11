// Pure helpers for the public share surface. No React, no I/O — imported by
// the SPA and by the public-recipe Edge Function via the _shared/domain symlink.

export function sharePath(token: string): string {
  return `/r/${token}`;
}

export type ShareSummaryInput = {
  description: string | null;
  servings: number;
  total_time_min: number | null;
  ingredientCount: number;
};

const MAX_SUMMARY = 160;

// One-line summary for OG descriptions: the recipe's own description when it
// has one (truncated to MAX_SUMMARY on a word boundary), otherwise a
// "4 servings · 55 min · 9 ingredients" facts line.
export function shareSummary(input: ShareSummaryInput): string {
  const desc = input.description?.trim();
  if (desc) {
    if (desc.length <= MAX_SUMMARY) return desc;
    const cut = desc.slice(0, MAX_SUMMARY - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  const parts = [`${input.servings} ${input.servings === 1 ? 'serving' : 'servings'}`];
  if (input.total_time_min != null && input.total_time_min > 0) {
    parts.push(`${input.total_time_min} min`);
  }
  parts.push(
    `${input.ingredientCount} ${input.ingredientCount === 1 ? 'ingredient' : 'ingredients'}`,
  );
  return parts.join(' · ');
}

export type ShareIngredient = {
  raw_text: string | null;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
};

export type ShareStep = {
  body: string;
  position: number;
};

export type ShareRecipe = {
  title: string;
  description: string | null;
  servings: number;
  total_time_min: number | null;
  source_url: string | null;
  source_language: string;
  tags: string[];
  ingredients: ShareIngredient[];
  steps: ShareStep[];
};

export type RecipeJsonLdOptions = {
  url: string;
  imageUrl: string;
  householdName: string;
};

// One display line per ingredient. Prefers the imported `raw_text`; otherwise
// composes "<qty> <unit> <name> (<notes>)" from the structured fields. Shared
// by the JSON-LD `recipeIngredient` list and the page's visible <ul> so the
// two never drift apart.
export function ingredientLine(ing: ShareIngredient): string {
  const raw = ing.raw_text?.trim();
  if (raw) return raw;
  const parts: string[] = [];
  if (ing.quantity != null) parts.push(String(ing.quantity));
  if (ing.unit) parts.push(ing.unit);
  parts.push(ing.ingredient_name);
  const head = parts.join(' ').trim();
  const notes = ing.notes?.trim();
  return notes ? `${head} (${notes})` : head;
}

// ISO-8601 duration for Schema.org `totalTime`. Null/non-positive -> null (omit).
export function isoDuration(min: number | null): string | null {
  return min != null && min > 0 ? `PT${min}M` : null;
}

// Schema.org Recipe projection for the public page's <script type="ld+json">.
// Pure: returns a plain object; the Edge Function serialises and HTML-escapes
// it. Optional fields are omitted (not emitted as null) when absent.
export function recipeJsonLd(
  recipe: ShareRecipe,
  opts: RecipeJsonLdOptions,
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    url: opts.url,
    mainEntityOfPage: opts.url,
    image: [opts.imageUrl],
    author: { '@type': 'Organization', name: opts.householdName },
    recipeYield: String(recipe.servings),
    recipeIngredient: recipe.ingredients.map(ingredientLine),
    recipeInstructions: recipe.steps.map((s) => ({ '@type': 'HowToStep', text: s.body })),
    inLanguage: recipe.source_language,
  };
  const description = recipe.description?.trim();
  if (description) jsonLd.description = description;
  const totalTime = isoDuration(recipe.total_time_min);
  if (totalTime) jsonLd.totalTime = totalTime;
  if (recipe.tags.length > 0) jsonLd.keywords = recipe.tags.join(', ');
  return jsonLd;
}
