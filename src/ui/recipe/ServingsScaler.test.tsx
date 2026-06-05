import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServingsScaler } from './ServingsScaler';

function Harness({
  onChange,
  defaultServings = 4,
  initialServings = 4,
}: { onChange?: (v: number) => void; defaultServings?: number; initialServings?: number } = {}) {
  const [servings, setServings] = useState(initialServings);
  return (
    <ServingsScaler
      servings={servings}
      defaultServings={defaultServings}
      onChange={(v) => {
        setServings(v);
        onChange?.(v);
      }}
    />
  );
}

describe('ServingsScaler', () => {
  it('renders snap pills, slider, and numeric input', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Servings ratio' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Servings' })).toBeInTheDocument();
  });

  it('marks the active pill via aria-pressed', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a pill fires onChange with that count', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '6' }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('using the number input increments servings', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Increment' }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('matches the active pill for a non-default-base recipe', () => {
    // Recipe defaults to 3 servings; a click that lands on 6 should mark the
    // 6-pill active even though 6 is not the recipe default.
    render(<Harness defaultServings={3} initialServings={6} />);
    expect(screen.getByRole('button', { name: '6' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets the numeric input climb past default*4 on a 1-serving recipe', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Old behaviour clamped max to default*4 = 4; the increment button would
    // disable at 4. The pills go to 8, so the input must reach at least 8.
    render(<Harness defaultServings={1} initialServings={5} onChange={onChange} />);
    const inc = screen.getByRole('button', { name: 'Increment' });
    expect(inc).not.toBeDisabled();
    await user.click(inc);
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('selecting the largest pill on a 1-serving recipe fires onChange and marks it active', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness defaultServings={1} initialServings={1} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '8' }));
    expect(onChange).toHaveBeenCalledWith(8);
    expect(screen.getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'true');
  });
});
