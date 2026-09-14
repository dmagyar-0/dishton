// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `rpc` returns the search hits; `from('recipe_tags')` is the follow-up tag
// fetch, stubbed as an empty thenable builder.
const mocks = vi.hoisted(() => {
  const rpcResult = { value: { data: [] as unknown, error: null as unknown } };
  const rpc = vi.fn(async () => rpcResult.value);
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'in']) builder[m] = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder stub, like PostgREST
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { rpcResult, rpc, fromMock: vi.fn(() => builder) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.fromMock } }));
vi.mock('@/observability/analytics', () => ({ track: vi.fn() }));

import { useRecipeSearch } from './search';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const row = (id: string, household_id: string) => ({ id, household_id, title: id });

describe('useRecipeSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpcResult.value = { data: [], error: null };
  });

  it('does not widen the search to links by default', async () => {
    const { result } = renderHook(() => useRecipeSearch('stew', ['h1']), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('search_recipes', {
      q: 'stew',
      household_ids: ['h1'],
      include_links: false,
    });
  });

  it('asks for links when the caller merges them', async () => {
    const { result } = renderHook(() => useRecipeSearch('stew', ['h1'], true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('search_recipes', {
      q: 'stew',
      household_ids: ['h1'],
      include_links: true,
    });
  });

  it('marks a hit from another household as a link, so the card badges it', async () => {
    mocks.rpcResult.value = { data: [row('own', 'h1'), row('linked', 'h-other')], error: null };
    const { result } = renderHook(() => useRecipeSearch('stew', ['h1'], true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const byId = Object.fromEntries((result.current.data ?? []).map((r) => [r.id, r]));
    expect(byId.own?.is_link).toBeUndefined();
    expect(byId.linked?.is_link).toBe(true);
  });

  it('keeps the link marking after tags are merged in', async () => {
    mocks.rpcResult.value = { data: [row('linked', 'h-other')], error: null };
    const { result } = renderHook(() => useRecipeSearch('stew', ['h1'], true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ is_link: true, recipe_tags: [] });
  });

  it('stays idle until the query is long enough to search', () => {
    const { result } = renderHook(() => useRecipeSearch('s', ['h1'], true), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
