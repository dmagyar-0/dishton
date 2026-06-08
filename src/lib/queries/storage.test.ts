import { describe, expect, it, vi } from 'vitest';

// storage.ts imports the supabase client at module load; stub it so the pure
// helper under test imports without real env/config.
vi.mock('../supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { staleHeroImagePath } from './storage';

describe('staleHeroImagePath', () => {
  it('returns the previous owned path when it changed', () => {
    expect(staleHeroImagePath('u1/a.jpg', 'u1/b.jpg')).toBe('u1/a.jpg');
  });

  it('returns the previous owned path when the image was removed', () => {
    expect(staleHeroImagePath('u1/a.jpg', null)).toBe('u1/a.jpg');
  });

  it('returns null when the path is unchanged', () => {
    expect(staleHeroImagePath('u1/a.jpg', 'u1/a.jpg')).toBeNull();
  });

  it('returns null when there was no previous image', () => {
    expect(staleHeroImagePath(null, 'u1/b.jpg')).toBeNull();
  });

  it('never deletes a remote (imported) URL', () => {
    expect(staleHeroImagePath('https://cdn.example.com/x.jpg', 'u1/b.jpg')).toBeNull();
  });
});
