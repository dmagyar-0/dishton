import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'app.name' ? 'Dishton' : key) }),
}));

import { AuthWordmark } from './AuthWordmark';

describe('AuthWordmark', () => {
  it('renders the app name', () => {
    render(<AuthWordmark />);
    expect(screen.getByText('Dishton')).toBeInTheDocument();
  });

  it('applies display font and aubergine colour classes', () => {
    render(<AuthWordmark />);
    const el = screen.getByText('Dishton');
    expect(el).toHaveClass('font-display');
    expect(el).toHaveClass('text-aubergine');
  });
});
