import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CustomizeHomeSheet } from './CustomizeHomeSheet';

const LIBRARY = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'soup'];

function setup(overrides: { homeTags?: string[] } = {}) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CustomizeHomeSheet
      open
      onOpenChange={onOpenChange}
      library={LIBRARY}
      homeTags={overrides.homeTags ?? ['breakfast', 'lunch']}
      onSave={onSave}
    />,
  );
  return { onSave, onOpenChange };
}

describe('CustomizeHomeSheet', () => {
  it('renders a locked "All" tile plus every library category', () => {
    setup();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Breakfast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soup' })).toBeInTheDocument();
    // "All" is always on and cannot be removed.
    expect(screen.getByRole('button', { name: 'All' })).toBeDisabled();
  });

  it('marks the current Home set as selected', () => {
    setup({ homeTags: ['breakfast'] });
    expect(screen.getByRole('button', { name: 'Breakfast' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Soup' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('counts the implicit "All" tile toward the cap', () => {
    setup({ homeTags: ['breakfast', 'lunch'] });
    // 2 stored + All = 3 of 5.
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });

  it('adds a category to the saved selection when toggled on', async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ homeTags: ['breakfast', 'lunch'] });
    await user.click(screen.getByRole('button', { name: 'Soup' }));
    await user.click(screen.getByRole('button', { name: 'search.customize_done' }));
    expect(onSave).toHaveBeenCalledWith(['breakfast', 'lunch', 'soup']);
  });

  it('blocks new picks once the 5-category cap (incl. All) is reached', async () => {
    const user = userEvent.setup();
    // 4 stored + All = 5 = full.
    setup({ homeTags: ['breakfast', 'lunch', 'dinner', 'dessert'] });
    expect(screen.getByText('5 / 5')).toBeInTheDocument();
    // An unselected tile is blocked...
    expect(screen.getByRole('button', { name: 'Soup' })).toBeDisabled();
    // ...until a slot is freed by removing a selected one.
    await user.click(screen.getByRole('button', { name: 'Dinner' }));
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soup' })).toBeEnabled();
  });

  it('saves the unchanged selection when Done is pressed', async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ homeTags: ['breakfast', 'lunch'] });
    await user.click(screen.getByRole('button', { name: 'search.customize_done' }));
    expect(onSave).toHaveBeenCalledWith(['breakfast', 'lunch']);
  });
});
