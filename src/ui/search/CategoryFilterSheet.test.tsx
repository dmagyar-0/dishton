import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CategoryFilterSheet } from './CategoryFilterSheet';

const LIBRARY = ['breakfast', 'lunch', 'soup', 'vegan'];

function setup(overrides: { selected?: string[] } = {}) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CategoryFilterSheet
      open
      onOpenChange={onOpenChange}
      library={LIBRARY}
      selected={overrides.selected ?? []}
      onToggle={onToggle}
      onClear={onClear}
    />,
  );
  return { onToggle, onClear, onOpenChange };
}

describe('CategoryFilterSheet', () => {
  it('renders a chip for every category in the library', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Breakfast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vegan' })).toBeInTheDocument();
  });

  it('marks active categories via aria-pressed', () => {
    setup({ selected: ['soup'] });
    expect(screen.getByRole('button', { name: 'Soup' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lunch' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the tag when a chip is clicked', async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();
    await user.click(screen.getByRole('button', { name: 'Lunch' }));
    expect(onToggle).toHaveBeenCalledWith('lunch');
  });

  it('clears all filters via the clear action', async () => {
    const user = userEvent.setup();
    const { onClear } = setup({ selected: ['soup', 'lunch'] });
    await user.click(screen.getByRole('button', { name: 'search.clear_filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('closes when Done is pressed', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();
    await user.click(screen.getByRole('button', { name: 'search.filter_done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
