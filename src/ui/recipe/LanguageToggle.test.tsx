import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageToggle } from './LanguageToggle';

const OPTS = [
  { code: 'en', native: 'English' },
  { code: 'fr', native: 'Français' },
  { code: 'de', native: 'Deutsch' },
];

describe('LanguageToggle', () => {
  it('renders a select with all options', () => {
    render(<LanguageToggle value="en" options={OPTS} onChange={() => {}} />);
    const sel = screen.getByRole('combobox', { name: 'Language' });
    expect(sel).toHaveValue('en');
    expect(sel.children).toHaveLength(3);
  });

  it('fires onChange with new code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguageToggle value="en" options={OPTS} onChange={onChange} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'fr');
    expect(onChange).toHaveBeenCalledWith('fr');
  });
});
