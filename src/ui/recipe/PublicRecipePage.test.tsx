import type { PublicRecipePayload } from '@/lib/queries/shares';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const payload: PublicRecipePayload = {
  recipe: {
    title: 'Tomato Tarte Tatin',
    description: 'A savoury upside-down pastry.',
    source_type: 'manual',
    source_url: null,
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: 55,
    hero_image_path: null,
    tags: ['tomato', 'pastry'],
    ingredients: [
      {
        position: 0,
        raw_text: '500 g cherry tomatoes',
        quantity: 500,
        unit: 'g',
        ingredient_name: 'cherry tomatoes',
        notes: null,
        section: null,
      },
    ],
    steps: [{ position: 0, body: 'Heat oven to 200C.', duration_min: 5 }],
  },
  household_name: 'The Pantry',
};

let rpcData: PublicRecipePayload | null = payload;
const rpcLoading = false;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars && 'name' in vars ? `${key}::${vars.name}` : key,
  }),
}));
vi.mock('@/lib/queries/shares', () => ({
  usePublicRecipe: () => ({ data: rpcData, isLoading: rpcLoading, isError: false }),
  usePublicHeroImage: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}));

import { PublicRecipePage } from './PublicRecipePage';

function renderPage() {
  return render(
    <PublicRecipePage token="tok123" onServingsChange={vi.fn()} onUnitsChange={vi.fn()} />,
  );
}

describe('PublicRecipePage', () => {
  it('renders title, attribution, ingredients, steps, and the signup CTA', () => {
    rpcData = payload;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeInTheDocument();
    expect(screen.getByText('public.from_household::The Pantry')).toBeInTheDocument();
    expect(screen.getByText('cherry tomatoes')).toBeInTheDocument();
    expect(screen.getByText('Heat oven to 200C.')).toBeInTheDocument();
    expect(screen.getAllByText('public.cta_action').length).toBeGreaterThan(0);
    expect(screen.queryByText('recipe.edit_action')).not.toBeInTheDocument();
  });

  it('renders the inactive state for a dead link', () => {
    rpcData = null;
    renderPage();
    expect(screen.getByText('public.inactive_title')).toBeInTheDocument();
    expect(screen.getByText('public.inactive_action')).toBeInTheDocument();
  });
});
