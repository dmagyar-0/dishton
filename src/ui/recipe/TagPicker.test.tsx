import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagPicker } from './TagPicker';

const ALLOWED = ['main', 'dessert', 'mushroom'];

describe('TagPicker', () => {
  it('toggles a tag on when its chip is clicked', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={[]} onChange={fn} allowedTags={ALLOWED} />);
    await user.click(screen.getByRole('button', { name: 'main' }));
    expect(fn).toHaveBeenCalledWith(['main']);
  });

  it('toggles a tag off when its chip is clicked while selected', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={['main', 'dessert']} onChange={fn} allowedTags={ALLOWED} />);
    await user.click(screen.getByRole('button', { name: 'main' }));
    expect(fn).toHaveBeenCalledWith(['dessert']);
  });

  it('reflects current selection via aria-pressed', () => {
    render(<TagPicker value={['mushroom']} onChange={vi.fn()} allowedTags={ALLOWED} />);
    expect(screen.getByRole('button', { name: 'mushroom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'main' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders off-list tags as removable read-only chips above the whitelist', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={['legacy-soup', 'main']} onChange={fn} allowedTags={ALLOWED} />);
    // The legacy tag is not a toggle button — it has only a Remove control.
    expect(screen.queryByRole('button', { name: 'legacy-soup' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /remove legacy-soup/i }));
    expect(fn).toHaveBeenCalledWith(['main']);
  });

  it('shows an empty-state message when the whitelist is empty', () => {
    render(<TagPicker value={[]} onChange={vi.fn()} allowedTags={[]} />);
    expect(screen.getByText(/no tags configured/i)).toBeInTheDocument();
  });
});
