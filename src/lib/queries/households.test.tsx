// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable, awaitable Supabase query-builder stub plus a separate `rpc`
// stub, so we can assert which channel each hook reads through.
const mocks = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gt', 'is', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder stub, like PostgREST
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const fromMock = vi.fn(() => builder);
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const rpcMock = vi.fn(() => Promise.resolve(rpcResult.value));
  return { result, builder, fromMock, rpcResult, rpcMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.fromMock, rpc: mocks.rpcMock },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ memberships: [] }),
  refreshAuthDerivedState: vi.fn(),
}));

import { useFollowedHouseholds, useFollowersOfHousehold } from './households';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useFollowersOfHousehold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result.value = { data: null, error: null };
    mocks.rpcResult.value = { data: null, error: null };
  });

  // A household cannot SELECT the rows of households that follow *it* — the
  // households RLS policy only covers members and the households you follow.
  // Reading followers through a PostgREST embed therefore yielded a null
  // household per row, and rendering `household.name` white-screened the whole
  // /households page. The RPC returns the follower name from a definer-side
  // join, so the name is always present.
  it('reads followers through the list_household_followers RPC', async () => {
    mocks.rpcResult.value = {
      data: [
        { follower_household_id: 'h_follower', name: 'Nagyi konyhája', created_at: '2026-06-14' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useFollowersOfHousehold('h_mine'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(mocks.rpcMock).toHaveBeenCalledWith('list_household_followers', {
      p_household: 'h_mine',
    });
    expect(result.current.data).toEqual([
      {
        follower_household_id: 'h_follower',
        household: { id: 'h_follower', name: 'Nagyi konyhája' },
        created_at: '2026-06-14',
      },
    ]);
  });

  it('propagates an RPC error instead of returning half-built rows', async () => {
    mocks.rpcResult.value = { data: null, error: { message: 'denied' } };

    const { result } = renderHook(() => useFollowersOfHousehold('h_mine'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useFollowedHouseholds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result.value = { data: null, error: null };
    mocks.rpcResult.value = { data: null, error: null };
  });

  // Defence in depth: this path still uses an embed, so an unreadable
  // household must degrade to a missing row rather than a null dereference.
  it('drops follow rows whose household embed came back null', async () => {
    mocks.result.value = {
      data: [
        {
          followed_household_id: 'h_ok',
          created_at: '2026-06-14',
          households: { id: 'h_ok', name: 'Readable' },
        },
        { followed_household_id: 'h_hidden', created_at: '2026-06-15', households: null },
      ],
      error: null,
    };

    const { result } = renderHook(() => useFollowedHouseholds('h_mine'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual([
      {
        followed_household_id: 'h_ok',
        created_at: '2026-06-14',
        household: { id: 'h_ok', name: 'Readable' },
      },
    ]);
  });
});
