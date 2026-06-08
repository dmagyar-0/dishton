// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable supabase mock mirroring useChatMessages:
//   from('recipe_chat_messages').select(...).eq(...).order('created_at')
// plus the realtime channel it opens. We capture the postgres_changes handler
// and the .subscribe() status callback so tests can drive both paths.
const mocks = vi.hoisted(() => {
  const orderMock = vi.fn();
  const eqMock = vi.fn(() => ({ order: orderMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  const handlers: { pg?: () => void; status?: (s: string) => void } = {};
  const channelObj: Record<string, unknown> = {};
  channelObj.on = vi.fn((_event: unknown, _config: unknown, cb: () => void) => {
    handlers.pg = cb;
    return channelObj;
  });
  channelObj.subscribe = vi.fn((cb?: (s: string) => void) => {
    handlers.status = cb;
    return channelObj;
  });
  const channelMock = vi.fn(() => channelObj);
  const removeChannelMock = vi.fn();
  return { orderMock, eqMock, selectMock, fromMock, channelMock, removeChannelMock, handlers };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.fromMock,
    channel: mocks.channelMock,
    removeChannel: mocks.removeChannelMock,
  },
}));

import { useChatMessages } from './recipe-chat';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useChatMessages live refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.pg = undefined;
    mocks.handlers.status = undefined;
    mocks.orderMock.mockResolvedValue({
      data: [{ id: 'm1', role: 'user', content: 'hi', created_at: 't1' }],
      error: null,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls for the agent reply while awaiting, even if realtime never fires', async () => {
    vi.useFakeTimers();
    renderHook(() => useChatMessages('s1', true), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.orderMock).toHaveBeenCalledTimes(1);
    // Realtime stays silent (no pg callback fired); polling must keep fetching.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(mocks.orderMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(mocks.orderMock).toHaveBeenCalledTimes(3);
  });

  it('does not poll when not awaiting a reply', async () => {
    vi.useFakeTimers();
    renderHook(() => useChatMessages('s1', false), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.orderMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mocks.orderMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the realtime channel subscribes (closes the subscribe gap)', async () => {
    renderHook(() => useChatMessages('s1', false), { wrapper });
    await waitFor(() => expect(mocks.orderMock).toHaveBeenCalledTimes(1));
    expect(typeof mocks.handlers.status).toBe('function');
    await act(async () => {
      mocks.handlers.status?.('SUBSCRIBED');
    });
    await waitFor(() => expect(mocks.orderMock).toHaveBeenCalledTimes(2));
  });

  it('refetches when a realtime INSERT event arrives', async () => {
    renderHook(() => useChatMessages('s1', false), { wrapper });
    await waitFor(() => expect(mocks.orderMock).toHaveBeenCalledTimes(1));
    expect(typeof mocks.handlers.pg).toBe('function');
    await act(async () => {
      mocks.handlers.pg?.();
    });
    await waitFor(() => expect(mocks.orderMock).toHaveBeenCalledTimes(2));
  });
});
