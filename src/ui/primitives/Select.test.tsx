import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

function Harness({
  onChange,
  initial = 'en',
  disabled,
  placeholder,
}: {
  onChange?: (v: string) => void;
  initial?: string | undefined;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <Select
      ariaLabel="lang"
      options={OPTIONS}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('Select', () => {
  it('exposes a combobox showing the selected label', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'lang' })).toHaveTextContent('English');
  });

  it('takes its accessible name from an associated label', () => {
    render(
      <>
        <label htmlFor="lang-pick">Recipe language</label>
        <Select id="lang-pick" options={OPTIONS} value="en" onValueChange={() => {}} />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'Recipe language' })).toBeInTheDocument();
  });

  it('opens the listbox on click and lists every option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('marks the current value as the selected option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'English' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selecting an option fires onValueChange and closes the listbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Français' }));
    expect(onChange).toHaveBeenCalledWith('fr');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects via keyboard with ArrowDown then Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('fr');
  });

  it('jumps to a matching option via type-ahead', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('d');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('closes on Escape without selecting', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the placeholder when no option matches the value', () => {
    render(<Harness initial="zz" placeholder="Pick one" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick one');
  });
});
