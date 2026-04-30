import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders multi-line', () => {
    render(<Textarea aria-label="notes" />);
    const el = screen.getByRole('textbox', { name: 'notes' });
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="r" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('accepts typing including newlines', async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="t" />);
    const el = screen.getByRole('textbox', { name: 't' });
    await user.type(el, 'a{Enter}b');
    expect(el).toHaveValue('a\nb');
  });

  it('honours disabled', () => {
    render(<Textarea aria-label="x" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
