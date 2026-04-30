import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster, useToast, useToastStore } from './Toast';

function Producer() {
  const { push } = useToast();
  return (
    <button type="button" onClick={() => push({ title: 'Saved' })}>
      fire
    </button>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes a toast onto the list', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Producer />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'fire' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('auto-dismisses after 5s', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push({ title: 'Saved' });
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('persist:true prevents auto dismiss', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push({ title: 'Sticky', persist: true });
    });
    expect(screen.getByText('Sticky')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('dismiss button removes the toast', async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push({ title: 'Bye', persist: true });
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Bye')).not.toBeInTheDocument();
  });
});
