import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// i18n: echo the key so we can assert which copy renders.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const { signInWithPassword, updateUser } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  // The component reads the email via useAuth((s) => s.user?.email ?? null).
  useAuth: (selector: (s: { user: { email: string } }) => unknown) =>
    selector({ user: { email: 'cook@example.com' } }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword, updateUser } },
}));

const push = vi.fn();
vi.mock('@/ui/primitives', async () => {
  const actual = await vi.importActual<typeof import('@/ui/primitives')>('@/ui/primitives');
  return { ...actual, useToast: () => ({ push }) };
});

import { ChangePasswordCard } from './ChangePasswordCard';

describe('ChangePasswordCard', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    updateUser.mockReset();
    push.mockReset();
  });

  async function fill(current: string, next: string, confirm: string) {
    const user = userEvent.setup();
    render(<ChangePasswordCard />);
    await user.type(screen.getByLabelText('profile.password.current_label'), current);
    await user.type(screen.getByLabelText('profile.password.new_label'), next);
    await user.type(screen.getByLabelText('profile.password.confirm_label'), confirm);
    await user.click(screen.getByRole('button', { name: 'profile.password.submit' }));
    return user;
  }

  it('re-authenticates with the current password before updating', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });

    await fill('oldpassword12', 'newpassword34', 'newpassword34');

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'cook@example.com',
        password: 'oldpassword12',
      });
    });
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpassword34' });
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success', title: 'profile.password.updated' }),
    );
  });

  it('shows an error and does not update when the current password is wrong', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    await fill('wrongpassword', 'newpassword34', 'newpassword34');

    expect(await screen.findByText('profile.password.current_incorrect')).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('blocks submission when the confirmation does not match', async () => {
    await fill('oldpassword12', 'newpassword34', 'differentpw56');

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
