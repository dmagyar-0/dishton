import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('renders with default variant', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>X</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('fires onClick on Enter and Space keys', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);
    const btn = screen.getByRole('button', { name: 'Press' });
    btn.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('disables interaction when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows spinner when loading and blocks clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Loading
      </Button>,
    );
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /loading/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('merges className', () => {
    render(<Button className="custom-class">Click</Button>);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('respects variant prop', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-pomegranate');
  });
});
