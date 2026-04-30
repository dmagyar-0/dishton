import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from './Drawer';

function Harness({ side }: { side?: 'bottom' | 'right' } = {}) {
  return (
    <Drawer>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent side={side}>
        <DrawerTitle>Filters</DrawerTitle>
        <DrawerDescription>Body</DrawerDescription>
      </DrawerContent>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens on trigger click and is announced as a dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg).toBeInTheDocument();
    expect(dlg).toHaveAttribute('data-side', 'bottom');
  });

  it('renders right-side variant', async () => {
    const user = userEvent.setup();
    render(<Harness side="right" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'right');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
