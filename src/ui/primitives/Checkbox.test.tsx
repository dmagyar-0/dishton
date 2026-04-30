import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders with role checkbox', () => {
    render(<Checkbox aria-label="agree" />);
    expect(screen.getByRole('checkbox', { name: 'agree' })).toBeInTheDocument();
  });

  it('toggles via Space key', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [c, setC] = useState(false);
      return <Checkbox aria-label="t" checked={c} onChange={(e) => setC(e.target.checked)} />;
    }
    render(<Harness />);
    const cb = screen.getByRole('checkbox');
    cb.focus();
    await user.keyboard(' ');
    expect(cb).toBeChecked();
  });

  it('respects disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="x" disabled onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows label text', () => {
    render(<Checkbox aria-label="ing" label="Onion" />);
    expect(screen.getByText('Onion')).toBeInTheDocument();
  });
});
