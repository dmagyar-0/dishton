import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { RadioGroup, RadioGroupItem } from './RadioGroup';

function Harness({ orientation }: { orientation?: 'row' | 'column' } = {}) {
  const [value, setValue] = useState('a');
  return (
    <RadioGroup value={value} onValueChange={setValue} orientation={orientation}>
      <RadioGroupItem value="a" label="A" />
      <RadioGroupItem value="b" label="B" />
      <RadioGroupItem value="c" label="C" />
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('renders with role radiogroup', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('selects via click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: 'B' }));
    expect(screen.getByRole('radio', { name: 'B' })).toBeChecked();
  });

  it('navigates with ArrowDown in column orientation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const a = screen.getByRole('radio', { name: 'A' });
    a.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'B' })).toBeChecked();
  });

  it('navigates with ArrowRight in row orientation', async () => {
    const user = userEvent.setup();
    render(<Harness orientation="row" />);
    screen.getByRole('radio', { name: 'A' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'B' })).toBeChecked();
  });

  it('honours disabled item', async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" label="A" />
        <RadioGroupItem value="b" label="B" disabled />
      </RadioGroup>,
    );
    const b = screen.getByRole('radio', { name: 'B' });
    await user.click(b);
    expect(b).not.toBeChecked();
  });
});
