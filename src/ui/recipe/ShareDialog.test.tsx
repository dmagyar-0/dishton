import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enableMock = vi.fn();
const disableMock = vi.fn();
const pushMock = vi.fn();
let shareData: { token: string } | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/queries/shares', () => ({
  useRecipeShare: () => ({ data: shareData, isLoading: false }),
  useEnableShare: () => ({ mutate: enableMock, isPending: false }),
  useDisableShare: () => ({ mutate: disableMock, isPending: false }),
}));
vi.mock('@/ui/primitives/Toast', () => ({ useToast: () => ({ push: pushMock }) }));

import { ShareDialog } from './ShareDialog';

describe('ShareDialog', () => {
  beforeEach(() => {
    enableMock.mockReset();
    disableMock.mockReset();
    pushMock.mockReset();
    shareData = null;
  });

  it('shows the toggle off with no link when unshared', async () => {
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'share.copy_link' })).not.toBeInTheDocument();
  });

  it('enables sharing when the switch is turned on', async () => {
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    await user.click(screen.getByRole('switch'));
    expect(enableMock).toHaveBeenCalledTimes(1);
    expect(disableMock).not.toHaveBeenCalled();
  });

  it('shows the share URL and copies it when shared', async () => {
    shareData = { token: 'cafe0123cafe0123cafe0123cafe0123' };
    // userEvent.setup() installs a working clipboard stub in jsdom; assert
    // through it rather than monkey-patching navigator.
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/\/r\/cafe0123cafe0123cafe0123cafe0123/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'share.copy_link' }));
    await expect(navigator.clipboard.readText()).resolves.toContain(
      '/r/cafe0123cafe0123cafe0123cafe0123',
    );
    expect(pushMock).toHaveBeenCalled();
  });

  it('disables sharing when the switch is turned off', async () => {
    shareData = { token: 'cafe0123cafe0123cafe0123cafe0123' };
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    await user.click(screen.getByRole('switch'));
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(enableMock).not.toHaveBeenCalled();
  });
});
