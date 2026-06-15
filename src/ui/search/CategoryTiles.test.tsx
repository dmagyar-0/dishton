import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CategoryTiles } from './CategoryTiles';

const items = [
  { id: 'all', label: 'All' },
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'dinner', label: 'Dinner' },
];

describe('CategoryTiles', () => {
  it('renders a tile per category', () => {
    render(<CategoryTiles items={items} active="all" onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Breakfast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dinner' })).toBeInTheDocument();
  });

  it('marks the active category via aria-pressed', () => {
    render(<CategoryTiles items={items} active="breakfast" onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Breakfast' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onPick with the category id when a tile is clicked', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<CategoryTiles items={items} active="all" onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Dinner' }));
    expect(onPick).toHaveBeenCalledWith('dinner');
  });
});
