import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Input } from './Input';

describe('Input', () => {
  it('renders as text input by default', () => {
    render(<Input aria-label="email" />);
    const el = screen.getByRole('textbox', { name: 'email' });
    expect(el).toHaveAttribute('type', 'text');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('accepts typing', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="name" />);
    const el = screen.getByRole('textbox', { name: 'name' });
    await user.type(el, 'tom');
    expect(el).toHaveValue('tom');
  });

  it('respects disabled', () => {
    render(<Input aria-label="x" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
