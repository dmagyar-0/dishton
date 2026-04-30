import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagPicker } from './TagPicker';

describe('TagPicker', () => {
  it('adds tags on Enter', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={[]} onChange={fn} />);
    const input = screen.getByPlaceholderText(/add a tag/i);
    await user.type(input, 'Tomato{Enter}');
    expect(fn).toHaveBeenCalledWith(['tomato']);
  });

  it('rejects > 40 char inputs', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={[]} onChange={fn} />);
    await user.type(screen.getByPlaceholderText(/add a tag/i), `${'x'.repeat(41)}{Enter}`);
    expect(fn).not.toHaveBeenCalled();
  });

  it('removes tags via the X button', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagPicker value={['tomato', 'soup']} onChange={fn} />);
    await user.click(screen.getByRole('button', { name: /remove tomato/i }));
    expect(fn).toHaveBeenCalledWith(['soup']);
  });
});
