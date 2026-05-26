import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { IngredientRowEditor, type IngredientRowValue } from './IngredientRowEditor';

function baseValue(overrides: Partial<IngredientRowValue> = {}): IngredientRowValue {
  return {
    raw_text: '1 cup flour',
    quantity: 1,
    unit: 'cup_us',
    ingredient_name: 'flour',
    notes: null,
    section: null,
    ...overrides,
  };
}

describe('IngredientRowEditor', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let onMoveUp: ReturnType<typeof vi.fn>;
  let onMoveDown: ReturnType<typeof vi.fn>;
  let onRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    onMoveUp = vi.fn();
    onMoveDown = vi.fn();
    onRemove = vi.fn();
  });

  function renderRow(
    opts: { isFirst?: boolean; isLast?: boolean; value?: IngredientRowValue } = {},
  ) {
    return render(
      <ul>
        <IngredientRowEditor
          index={0}
          value={opts.value ?? baseValue()}
          isFirst={opts.isFirst ?? false}
          isLast={opts.isLast ?? false}
          onChange={onChange}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
        />
      </ul>,
    );
  }

  it('calls onMoveUp / onMoveDown / onRemove when the icon buttons are clicked', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'recipe.move_up' }));
    await user.click(screen.getByRole('button', { name: 'recipe.move_down' }));
    await user.click(screen.getByRole('button', { name: 'recipe.remove_row' }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('parses a fraction quantity on blur', async () => {
    const user = userEvent.setup();
    renderRow();
    const qty = screen.getByPlaceholderText('recipe.quantity_placeholder');
    await user.clear(qty);
    await user.type(qty, '1/2');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ quantity: { numerator: 1, denominator: 2 } });
  });

  it('surfaces an error when the quantity input is invalid', async () => {
    const user = userEvent.setup();
    renderRow();
    const qty = screen.getByPlaceholderText('recipe.quantity_placeholder');
    await user.clear(qty);
    await user.type(qty, 'abc');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('recipe.quantity_invalid');
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ quantity: expect.anything() }),
    );
  });

  it('clears the quantity when emptied', async () => {
    const user = userEvent.setup();
    renderRow();
    const qty = screen.getByPlaceholderText('recipe.quantity_placeholder');
    await user.clear(qty);
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ quantity: null });
  });
});
