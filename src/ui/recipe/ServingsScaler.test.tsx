import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServingsScaler } from './ServingsScaler';

function Harness({ onChange }: { onChange?: (v: number) => void } = {}) {
  const [servings, setServings] = useState(4);
  return (
    <ServingsScaler
      servings={servings}
      defaultServings={4}
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
});
