import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NumberInput, parseNumeric } from './NumberInput';

function Harness({
  initial = 1,
  min,
  max,
  step,
  onChange,
}: {
  initial?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (v: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      ariaLabel="qty"
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('parseNumeric', () => {
  it('parses decimals', () => {
    expect(parseNumeric('1.5')).toBe(1.5);
    expect(parseNumeric('  2 ')).toBe(2);
  });

  it('parses simple fractions', () => {
    expect(parseNumeric('1/2')).toBeCloseTo(0.5, 5);
  });

  it('parses mixed numbers', () => {
    expect(parseNumeric('1 1/2')).toBeCloseTo(1.5, 5);
    expect(parseNumeric('2 3/4')).toBeCloseTo(2.75, 5);
  });

  it('returns null on invalid input', () => {
    expect(parseNumeric('hello')).toBeNull();
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('1/0')).toBeNull();
  });
});

describe('NumberInput', () => {
  it('renders with aria-label', () => {
    render(<Harness initial={3} />);
    expect(screen.getByRole('textbox', { name: 'qty' })).toHaveValue('3');
  });

  it('increments via plus button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={1} step={1} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Increment' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('decrements via minus button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={3} step={1} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Decrement' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps to min/max on bump', async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} min={1} max={2} />);
    await user.click(screen.getByRole('button', { name: 'Decrement' }));
    expect(screen.getByRole('textbox', { name: 'qty' })).toHaveValue('1');
  });

  it('parses fractions on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={1} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'qty' });
    await user.clear(input);
    await user.type(input, '1 1/2');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it('disables minus at min', () => {
    render(<Harness initial={1} min={1} />);
    expect(screen.getByRole('button', { name: 'Decrement' })).toBeDisabled();
  });
});
