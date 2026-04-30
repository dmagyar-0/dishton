import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Slider } from './Slider';

function Harness({ onChange }: { onChange?: (v: number) => void } = {}) {
  const [value, setValue] = useState<number[]>([2]);
  return (
    <Slider
      aria-label="vol"
      min={0}
      max={5}
      step={1}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        if (v[0] !== undefined) onChange?.(v[0]);
      }}
    />
  );
}

describe('Slider', () => {
  it('exposes a slider role with current value', () => {
    render(<Harness />);
    const thumb = screen.getByRole('slider');
    expect(thumb).toHaveAttribute('aria-valuenow', '2');
  });

  it('responds to ArrowRight', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const thumb = screen.getByRole('slider');
    thumb.focus();
    await user.keyboard('{ArrowRight}');
    expect(thumb).toHaveAttribute('aria-valuenow', '3');
  });

  it('responds to ArrowLeft', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const thumb = screen.getByRole('slider');
    thumb.focus();
    await user.keyboard('{ArrowLeft}');
    expect(thumb).toHaveAttribute('aria-valuenow', '1');
  });
});
