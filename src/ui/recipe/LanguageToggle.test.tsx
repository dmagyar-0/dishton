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
  it('renders the selected language with its code', () => {
    render(<LanguageToggle value="en" options={OPTS} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English (en)');
  });

  it('lists every option when opened', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle value="en" options={OPTS} onChange={() => {}} />);
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('fires onChange with the new code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguageToggle value="en" options={OPTS} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(screen.getByRole('option', { name: 'Français (fr)' }));
    expect(onChange).toHaveBeenCalledWith('fr');
  });
});
