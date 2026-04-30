import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './Combobox';

const OPTIONS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
];

function Harness({ onChange }: { onChange?: (v: string) => void } = {}) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <Combobox
      ariaLabel="fruit"
      options={OPTIONS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('Combobox', () => {
  it('exposes the combobox role', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'fruit' })).toBeInTheDocument();
  });

  it('opens listbox on focus and shows options', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('filters by query', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const cb = screen.getByRole('combobox');
    await user.click(cb);
    await user.type(cb, 'ap');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Apple');
  });

  it('selects via Enter after ArrowDown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const cb = screen.getByRole('combobox');
    await user.click(cb);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const cb = screen.getByRole('combobox');
    await user.click(cb);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
