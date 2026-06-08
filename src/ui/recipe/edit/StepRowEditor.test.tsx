import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { StepRowEditor, type StepRowValue } from './StepRowEditor';

function baseValue(overrides: Partial<StepRowValue> = {}): StepRowValue {
  return {
    body: 'Whisk the eggs until pale.',
    duration_min: 3,
    ...overrides,
  };
}

describe('StepRowEditor', () => {
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
    opts: { isFirst?: boolean; isLast?: boolean; value?: StepRowValue; error?: string } = {},
  ) {
    return render(
      <ul>
        <StepRowEditor
          index={0}
          value={opts.value ?? baseValue()}
          isFirst={opts.isFirst ?? false}
          isLast={opts.isLast ?? false}
          onChange={onChange}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          error={opts.error}
        />
      </ul>,
    );
  }

  it('hooks up move and remove buttons', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'recipe.move_up' }));
    await user.click(screen.getByRole('button', { name: 'recipe.move_down' }));
    await user.click(screen.getByRole('button', { name: 'recipe.remove_row' }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('sends body edits through onChange', async () => {
    const user = userEvent.setup();
    renderRow({ value: baseValue({ body: 'Mix.' }) });
    const body = screen.getByRole('textbox', { name: /recipe\.field_step_body 1/i });
    await user.type(body, '!');
    expect(onChange).toHaveBeenLastCalledWith({ body: 'Mix.!' });
  });

  it('clears duration_min when the duration input is emptied', async () => {
    const user = userEvent.setup();
    renderRow();
    const duration = screen.getByRole('spinbutton', { name: 'recipe.field_step_duration' });
    await user.clear(duration);
    expect(onChange).toHaveBeenLastCalledWith({ duration_min: null });
  });

  it('renders the error message when provided', () => {
    renderRow({ error: 'recipe.step_body_required' });
    expect(screen.getByText('recipe.step_body_required')).toBeInTheDocument();
  });
});
