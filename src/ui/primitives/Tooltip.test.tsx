import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    render(
      <Tooltip content="Help text">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument();
  });

  it('exposes content via aria-describedby on focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Help text">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    await user.tab();
    expect(btn).toHaveFocus();
    expect(btn).toHaveAttribute('aria-describedby');
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Help text');
  });

  it('hides on blur', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Help">
        <button type="button">x</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby');
    await user.tab();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
  });
});
