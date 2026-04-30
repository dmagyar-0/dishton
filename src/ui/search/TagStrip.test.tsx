import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagStrip } from './TagStrip';

describe('TagStrip', () => {
  it('renders tags with optional counts', () => {
    render(
      <TagStrip
        tags={[{ tag: 'tomato', n: 3 }, { tag: 'soup' }]}
        selected={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('tomato')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('soup')).toBeInTheDocument();
  });

  it('toggles selection on click', async () => {
    const fn = vi.fn();
    const user = userEvent.setup();
    render(<TagStrip tags={[{ tag: 'tomato' }]} selected={[]} onToggle={fn} />);
    await user.click(screen.getByText('tomato'));
    expect(fn).toHaveBeenCalledWith('tomato');
  });

  it('marks selected via aria-pressed', () => {
    render(<TagStrip tags={[{ tag: 'soup' }]} selected={['soup']} onToggle={() => {}} />);
    expect(screen.getByText('soup').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
