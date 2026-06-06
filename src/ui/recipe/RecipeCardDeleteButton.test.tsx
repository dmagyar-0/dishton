import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateMock = vi.fn();
const pushMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (vars && 'title' in vars) return `${key}::${vars.title}`;
      return key;
    },
  }),
}));

vi.mock('@/lib/queries/recipes', () => ({
  useDeleteRecipe: () => ({
    mutate: mutateMock,
    isPending: false,
  }),
}));

vi.mock('@/ui/primitives/Toast', () => ({
  useToast: () => ({ push: pushMock }),
}));

import { RecipeCardDeleteButton } from './RecipeCardDeleteButton';

function renderButton() {
  return render(
    <RecipeCardDeleteButton
      recipeId="rec_123"
      recipeTitle="Saffron Risotto"
      householdId="h_abc"
      heroImagePath="u1/hero.jpg"
    />,
  );
}

describe('RecipeCardDeleteButton', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    pushMock.mockReset();
  });

  it('renders the trash button with the recipe title in its accessible name', () => {
    renderButton();
    expect(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    ).toBeInTheDocument();
  });

  it('opens a confirmation dialog with the recipe title in the body', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('recipe.delete_confirm_title')).toBeInTheDocument();
    expect(screen.getByText('recipe.delete_confirm_body::Saffron Risotto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recipe.delete_cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recipe.delete_confirm' })).toBeInTheDocument();
  });

  it('calls mutate with the recipe id and hero image path when the user confirms', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    );
    await user.click(screen.getByRole('button', { name: 'recipe.delete_confirm' }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      recipeId: 'rec_123',
      heroImagePath: 'u1/hero.jpg',
    });
  });

  it('cancel closes the dialog without calling mutate', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    );
    await user.click(screen.getByRole('button', { name: 'recipe.delete_cancel' }));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('on success: closes the dialog and pushes a success toast', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation(
      (_id: string, opts: { onSuccess?: () => void; onError?: () => void }) => {
        opts.onSuccess?.();
      },
    );
    renderButton();
    await user.click(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    );
    await user.click(screen.getByRole('button', { name: 'recipe.delete_confirm' }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'success',
        title: 'recipe.delete_success_title',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('on error: keeps the dialog open and pushes an error toast', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation(
      (_id: string, opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
        opts.onError?.(new Error('boom'));
      },
    );
    renderButton();
    await user.click(
      screen.getByRole('button', { name: /recipe\.delete_action: Saffron Risotto/i }),
    );
    await user.click(screen.getByRole('button', { name: 'recipe.delete_confirm' }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        title: 'recipe.delete_failed_title',
      }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
