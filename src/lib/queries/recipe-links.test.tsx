// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable, awaitable Supabase query-builder stub: every method returns the
// same builder, and awaiting it resolves the configurable `result`.
const mocks = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const builder: Record<string, unknown> = {};
  for (const m of ['insert', 'delete', 'select', 'eq', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder stub, like PostgREST
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const fromMock = vi.fn(() => builder);
  return { result, builder, fromMock };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.fromMock } }));

vi.mock('@/lib/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) =>
    sel({
      profile: { id: 'p1' },
      memberships: [{ household_id: 'h-personal', is_personal: true, role: 'owner' }],
    }),
}));

import {
  usePantryHouseholdId,
  useRecipeLinks,
  useRemoveRecipeLink,
  useSaveRecipeLink,
} from './recipe-links';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('recipe-links queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result.value = { data: null, error: null };
  });

  it('usePantryHouseholdId prefers the personal household', () => {
    const { result } = renderHook(() => usePantryHouseholdId(), { wrapper });
    expect(result.current).toBe('h-personal');
  });

  it('useSaveRecipeLink inserts a link with the caller as created_by', async () => {
    const { result } = renderHook(() => useSaveRecipeLink('h1'), { wrapper });
    await result.current.mutateAsync('r1');
    expect(mocks.fromMock).toHaveBeenCalledWith('recipe_links');
    expect(mocks.builder.insert).toHaveBeenCalledWith({
      household_id: 'h1',
      recipe_id: 'r1',
      created_by: 'p1',
    });
  });

  it('useSaveRecipeLink propagates an insert error', async () => {
    mocks.result.value = { data: null, error: { message: 'denied' } };
    const { result } = renderHook(() => useSaveRecipeLink('h1'), { wrapper });
    await expect(result.current.mutateAsync('r1')).rejects.toBeTruthy();
  });

  it('useRemoveRecipeLink scopes the delete and verifies it removed a row', async () => {
    mocks.result.value = { data: [{ recipe_id: 'r1' }], error: null };
    const { result } = renderHook(() => useRemoveRecipeLink('h1'), { wrapper });
    await result.current.mutateAsync('r1');
    expect(mocks.builder.eq).toHaveBeenCalledWith('household_id', 'h1');
    expect(mocks.builder.eq).toHaveBeenCalledWith('recipe_id', 'r1');
    expect(mocks.builder.select).toHaveBeenCalledWith('recipe_id');
  });

  it('useRemoveRecipeLink throws when the RLS-blocked delete removes no rows', async () => {
    mocks.result.value = { data: [], error: null };
    const { result } = renderHook(() => useRemoveRecipeLink('h1'), { wrapper });
    await expect(result.current.mutateAsync('r1')).rejects.toThrow(
      'recipe_link_remove_not_permitted',
    );
  });

  it('useRecipeLinks flattens joined rows and stamps is_link with the save time', async () => {
    mocks.result.value = {
      data: [
        {
          created_at: '2026-06-14T00:00:00Z',
          recipe: {
            id: 'r1',
            household_id: 'src',
            title: 'Borrowed Stew',
            description: null,
            hero_image_path: null,
            total_time_min: 30,
            source_type: 'manual',
            recipe_tags: [{ tag: 'soup' }],
          },
        },
      ],
      error: null,
    };
    const { result } = renderHook(() => useRecipeLinks('h1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: 'r1',
        household_id: 'src',
        title: 'Borrowed Stew',
        description: null,
        hero_image_path: null,
        total_time_min: 30,
        source_type: 'manual',
        recipe_tags: [{ tag: 'soup' }],
        created_at: '2026-06-14T00:00:00Z',
        is_link: true,
      },
    ]);
  });
});
