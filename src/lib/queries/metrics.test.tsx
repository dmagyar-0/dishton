// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const rpcMock = vi.fn(() => Promise.resolve(rpcResult.value));
  const authState = { session: null as { user: { id: string } } | null };
  return { rpcResult, rpcMock, authState };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mocks.rpcMock },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel(mocks.authState),
}));

import {
  dateRangeBounds,
  fetchIsAppAdmin,
  useIsAppAdmin,
  useMetricsActiveUsers,
  useMetricsStuckImports,
} from './metrics';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpcResult.value = { data: null, error: null };
  mocks.authState.session = null;
});

describe('dateRangeBounds', () => {
  it('is inclusive of both endpoints', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    expect(dateRangeBounds(7, now)).toEqual({ from: '2026-07-26', to: '2026-08-01' });
    expect(dateRangeBounds(30, now)).toEqual({ from: '2026-07-03', to: '2026-08-01' });
    expect(dateRangeBounds(90, now)).toEqual({ from: '2026-05-04', to: '2026-08-01' });
  });
});

describe('fetchIsAppAdmin', () => {
  it('returns true when the RPC says so', async () => {
    mocks.rpcResult.value = { data: true, error: null };
    await expect(fetchIsAppAdmin()).resolves.toBe(true);
  });

  it('fails closed (false) on any RPC error, including the expected not_app_admin', async () => {
    mocks.rpcResult.value = { data: null, error: { message: 'not_app_admin' } };
    await expect(fetchIsAppAdmin()).resolves.toBe(false);
  });

  it('fails closed (false) when the RPC throws', async () => {
    mocks.rpcMock.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    await expect(fetchIsAppAdmin()).resolves.toBe(false);
  });

  it('fails closed (false) on a non-boolean-true response', async () => {
    mocks.rpcResult.value = { data: false, error: null };
    await expect(fetchIsAppAdmin()).resolves.toBe(false);
  });
});

describe('useIsAppAdmin', () => {
  it('does not call the RPC when signed out', async () => {
    mocks.authState.session = null;
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper });
    // enabled:false means the query stays idle and never fetches.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.data).toBeUndefined();
    expect(mocks.rpcMock).not.toHaveBeenCalled();
  });

  it('calls is_app_admin once signed in', async () => {
    mocks.authState.session = { user: { id: 'p_1' } };
    mocks.rpcResult.value = { data: true, error: null };
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(mocks.rpcMock).toHaveBeenCalledWith('is_app_admin');
  });
});

describe('useMetricsActiveUsers', () => {
  it('calls the RPC with the resolved date range and returns the rows', async () => {
    mocks.rpcResult.value = {
      data: [{ day: '2026-08-01', dau: 3, wau_rolling: 5, mau_rolling: 9 }],
      error: null,
    };
    const { result } = renderHook(
      () => useMetricsActiveUsers({ from: '2026-07-26', to: '2026-08-01' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.rpcMock).toHaveBeenCalledWith('metrics_active_users', {
      p_from: '2026-07-26',
      p_to: '2026-08-01',
    });
    expect(result.current.data).toEqual([
      { day: '2026-08-01', dau: 3, wau_rolling: 5, mau_rolling: 9 },
    ]);
  });

  it('propagates an RPC error (e.g. a non-admin caller) instead of a silent empty result', async () => {
    mocks.rpcResult.value = { data: null, error: { message: 'not_app_admin' } };
    const { result } = renderHook(
      () => useMetricsActiveUsers({ from: '2026-07-26', to: '2026-08-01' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useMetricsStuckImports', () => {
  it('calls the RPC with no arguments', async () => {
    mocks.rpcResult.value = { data: [], error: null };
    const { result } = renderHook(() => useMetricsStuckImports(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.rpcMock).toHaveBeenCalledWith('metrics_stuck_imports');
  });
});
