import type { Recipe } from '@/domain/recipe';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RecipeEditForm } from './RecipeEditForm';

const ALLOWED = ['main', 'dessert'];

function sampleRecipe(): Recipe {
  return {
    title: 'Tomato Tarte Tatin',
    description: 'A savoury twist on the classic.',
    source_type: 'url',
    source_url: 'https://example.test/tarte',
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: 60,
    hero_image_path: null,
    tags: ['main'],
    ingredients: [
      {
        position: 0,
        raw_text: '500 g tomatoes',
        quantity: 500,
        unit: 'g',
        ingredient_name: 'tomatoes',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
      {
        position: 1,
        raw_text: '1 sheet puff pastry',
        quantity: 1,
        unit: 'count',
        ingredient_name: 'puff pastry',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
    ],
    steps: [
      { position: 0, body: 'Preheat oven.', duration_min: 5 },
      { position: 1, body: 'Roast tomatoes.', duration_min: 30 },
    ],
  };
}

describe('RecipeEditForm', () => {
  it('hydrates defaults into the basics inputs', () => {
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Tomato Tarte Tatin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A savoury twist on the classic.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
  });

  it('submits re-indexed positions when ingredients are reordered', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // The second ingredient row has a "move up" button — click it to swap with the first.
    const ingredientRows = screen.getAllByRole('listitem');
    // First listitem is the first ingredient row; the second ingredient row is index 1.
    const secondRow = ingredientRows[1];
    if (!secondRow) throw new Error('no second ingredient row');
    await user.click(within(secondRow).getByRole('button', { name: 'recipe.move_up' }));

    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]?.[0] as Recipe;
    expect(submitted.ingredients.map((i) => i.position)).toEqual([0, 1]);
    expect(submitted.ingredients[0]?.ingredient_name).toBe('puff pastry');
    expect(submitted.ingredients[1]?.ingredient_name).toBe('tomatoes');
  });

  it('does not submit when the title is empty', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const title = screen.getByDisplayValue('Tomato Tarte Tatin');
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('fires onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'recipe.edit_cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a row error and blocks submit when a step body is emptied', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.clear(screen.getByDisplayValue('Preheat oven.'));
    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('recipe.step_body_required')).toBeInTheDocument();
  });

  it('surfaces a row error and blocks submit when an ingredient line is emptied', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.clear(screen.getByDisplayValue('500 g tomatoes'));
    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('recipe.ingredient_text_required')).toBeInTheDocument();
  });

  it('uses a custom submit label when provided', () => {
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="import.manual_submit"
      />,
    );
    expect(screen.getByRole('button', { name: 'import.manual_submit' })).toBeInTheDocument();
  });
});
