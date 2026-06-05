import { niceQuantity } from './fractions.ts';
import type { Quantity, Recipe } from './recipe.ts';

export function quantityToNumber(q: Quantity): number {
  return typeof q === 'number' ? q : q.numerator / q.denominator;
}

/**
 * True when a quantity carries no meaningful amount: null, the number 0, or a
 * `0/n` fraction. Such ingredients render without a leading "0" on display.
 */
export function quantityIsEmpty(q: Quantity | null | undefined): boolean {
  if (q == null) return true;
  if (typeof q === 'number') return q === 0;
  return q.numerator === 0;
}

export function scale(recipe: Recipe, factor: number): Recipe {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('scale factor must be positive and finite');
  }
  return {
    ...recipe,
    servings: Math.max(1, Math.round(recipe.servings * factor)),
    ingredients: recipe.ingredients.map((ing) => {
      if (!ing.scalable || ing.quantity == null) return { ...ing };
      const q = quantityToNumber(ing.quantity) * factor;
      const snapped = niceQuantity(q, ing.unit);
      return { ...ing, quantity: snapped };
    }),
  };
}

export function scaleToServings(recipe: Recipe, target: number): Recipe {
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('target servings must be positive and finite');
  }
  return scale(recipe, target / recipe.servings);
}
