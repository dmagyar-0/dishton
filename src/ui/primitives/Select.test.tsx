import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

describe('Select', () => {
  it('renders a native select element', () => {
    render(
      <Select aria-label="lang" defaultValue="en">
        <option value="en">English</option>
        <option value="fr">Français</option>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'lang' })).toBeInTheDocument();
  });

  it('updates on user selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select aria-label="lang" defaultValue="en" onChange={onChange}>
        <option value="en">English</option>
        <option value="fr">Français</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'lang' }), 'fr');
    expect(onChange).toHaveBeenCalled();
  });

  it('respects disabled', () => {
    render(
      <Select aria-label="lang" disabled>
        <option value="en">English</option>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'lang' })).toBeDisabled();
  });
});
