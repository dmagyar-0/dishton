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
