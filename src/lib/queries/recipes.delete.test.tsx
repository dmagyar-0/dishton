// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client with a chainable builder mirroring the calls in
// useDeleteRecipe: from('recipes').delete().eq('id', id).select('id') and
// storage.from('recipe-images').remove([path]).
const mocks = vi.hoisted(() => {
  const selectMock = vi.fn();
  const eqMock = vi.fn(() => ({ select: selectMock }));
  const deleteMock = vi.fn(() => ({ eq: eqMock }));
  const removeMock = vi.fn();
  const storageFromMock = vi.fn(() => ({ remove: removeMock }));
  const fromMock = vi.fn(() => ({ delete: deleteMock }));
  return { selectMock, eqMock, deleteMock, removeMock, storageFromMock, fromMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.fromMock,
    storage: { from: mocks.storageFromMock },
  },
}));

import { useDeleteRecipe } from './recipes';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDeleteRecipe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectMock.mockResolvedValue({ data: [{ id: 'r1' }], error: null });
    mocks.removeMock.mockResolvedValue({ data: [{}], error: null });
  });

  it('deletes via select() and frees the hero blob for a storage-path image', async () => {
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await result.current.mutateAsync({ recipeId: 'r1', heroImagePath: 'u1/hero.jpg' });

    expect(mocks.fromMock).toHaveBeenCalledWith('recipes');
    expect(mocks.eqMock).toHaveBeenCalledWith('id', 'r1');
    // `.select('id')` is what makes an RLS-blocked delete observable as 0 rows.
    expect(mocks.selectMock).toHaveBeenCalledWith('id');
    expect(mocks.storageFromMock).toHaveBeenCalledWith('recipe-images');
    expect(mocks.removeMock).toHaveBeenCalledWith(['u1/hero.jpg']);
  });

  it('skips storage removal for a remote-URL hero image', async () => {
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await result.current.mutateAsync({
      recipeId: 'r1',
      heroImagePath: 'https://cdn.example.com/x.jpg',
    });
    expect(mocks.removeMock).not.toHaveBeenCalled();
  });

  it('skips storage removal when there is no hero image', async () => {
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await result.current.mutateAsync({ recipeId: 'r1', heroImagePath: null });
    expect(mocks.removeMock).not.toHaveBeenCalled();
  });

  it('throws when the delete removes no rows (RLS no-op) and leaves storage alone', async () => {
    mocks.selectMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await expect(
      result.current.mutateAsync({ recipeId: 'r1', heroImagePath: 'u1/hero.jpg' }),
    ).rejects.toThrow('recipe_delete_not_permitted');
    expect(mocks.removeMock).not.toHaveBeenCalled();
  });

  it('still resolves when the best-effort storage removal returns an error', async () => {
    mocks.removeMock.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await expect(
      result.current.mutateAsync({ recipeId: 'r1', heroImagePath: 'u1/hero.jpg' }),
    ).resolves.toBe('r1');
  });

  it('still resolves when the best-effort storage removal rejects', async () => {
    mocks.removeMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await expect(
      result.current.mutateAsync({ recipeId: 'r1', heroImagePath: 'u1/hero.jpg' }),
    ).resolves.toBe('r1');
  });

  it('propagates a delete error', async () => {
    mocks.selectMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useDeleteRecipe('h1'), { wrapper });
    await expect(
      result.current.mutateAsync({ recipeId: 'r1', heroImagePath: null }),
    ).rejects.toBeTruthy();
    expect(mocks.removeMock).not.toHaveBeenCalled();
  });
});
