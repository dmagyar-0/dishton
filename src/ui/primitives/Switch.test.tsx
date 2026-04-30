import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

function Harness({ onChange }: { onChange?: (v: boolean) => void }) {
  const [value, setValue] = useState(false);
  return (
    <Switch
      label="dark mode"
      checked={value}
      onCheckedChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('Switch', () => {
  it('exposes role switch with aria-checked false initially', () => {
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'dark mode' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles via click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles via keyboard Enter/Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole('switch');
    sw.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('honours disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="x" checked={false} onCheckedChange={onChange} disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
