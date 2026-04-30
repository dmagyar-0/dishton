import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('exposes the label as aria-label', () => {
    render(<IconButton label="Open menu" icon={<span data-testid="ico" />} />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(screen.getByTestId('ico')).toBeInTheDocument();
  });

  it('hits the 40x40 minimum target', () => {
    render(<IconButton label="x" />);
    expect(screen.getByRole('button')).toHaveClass('h-10', 'w-10');
  });

  it('responds to clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="Click" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('honours disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="x" disabled onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
