// @vitest-environment jsdom
import type { Session, User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Membership, Profile } from './auth';

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  from: vi.fn(),
}));

vi.mock('./supabase', () => ({ supabase: supabaseMock }));

type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';
type AuthChangeCb = (event: AuthEvent, session: Session | null) => void | Promise<void>;

const BUILD_SHA_KEY = 'dishton.session.build_sha';

let lastAuthChangeCb: AuthChangeCb | null = null;

function makeUser(id: string): User {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2025-01-01T00:00:00Z',
  } as User;
}

function makeSession(userId: string): Session {
  return {
    access_token: `at-${userId}`,
    refresh_token: `rt-${userId}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: makeUser(userId),
  } as Session;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    display_name: 'Test User',
    avatar_url: null,
    locale: 'en',
    preferred_unit_system: 'metric',
    preferred_language: 'en',
    ...overrides,
  };
}

function mockProfileAndMemberships(profile: Profile | null, memberships: Membership[]) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: profile, error: null }),
          }),
        }),
      };
    }
    if (table === 'household_members') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: memberships, error: null }),
        }),
      };
    }
    return {
      select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    };
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  supabaseMock.auth.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  supabaseMock.auth.signOut.mockReset().mockResolvedValue({ error: null });
  supabaseMock.auth.onAuthStateChange.mockReset().mockImplementation((cb: AuthChangeCb) => {
    lastAuthChangeCb = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  supabaseMock.from.mockReset();
  lastAuthChangeCb = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('useAuth store', () => {
  it('starts empty with hydrated=false', async () => {
    const { useAuth } = await import('./auth');
    const s = useAuth.getState();
    expect(s.session).toBeNull();
    expect(s.user).toBeNull();
    expect(s.profile).toBeNull();
    expect(s.memberships).toEqual([]);
    expect(s.hydrated).toBe(false);
  });

  it('setSession derives user from session.user, and clears it on null', async () => {
    const { useAuth } = await import('./auth');
    const session = makeSession('u1');

    useAuth.getState().setSession(session);
    expect(useAuth.getState().session).toBe(session);
    expect(useAuth.getState().user?.id).toBe('u1');

    useAuth.getState().setSession(null);
    expect(useAuth.getState().session).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('setProfile sets profile without flipping hydrated', async () => {
    const { useAuth } = await import('./auth');
    expect(useAuth.getState().hydrated).toBe(false);
    useAuth.getState().setProfile(makeProfile({ display_name: 'Alex' }));
    expect(useAuth.getState().profile?.display_name).toBe('Alex');
    expect(useAuth.getState().hydrated).toBe(false);
  });

  it('setMemberships sets memberships AND flips hydrated to true', async () => {
    const { useAuth } = await import('./auth');
    useAuth.getState().setMemberships([{ household_id: 'h1', role: 'owner' }]);
    expect(useAuth.getState().memberships).toEqual([{ household_id: 'h1', role: 'owner' }]);
    expect(useAuth.getState().hydrated).toBe(true);
  });

  it('signOut calls supabase.auth.signOut and resets store', async () => {
    const { useAuth } = await import('./auth');
    useAuth.getState().setSession(makeSession('u1'));
    useAuth.getState().setProfile(makeProfile());
    useAuth.getState().setMemberships([{ household_id: 'h1', role: 'owner' }]);

    await useAuth.getState().signOut();

    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
    const s = useAuth.getState();
    expect(s.session).toBeNull();
    expect(s.user).toBeNull();
    expect(s.profile).toBeNull();
    expect(s.memberships).toEqual([]);
    expect(s.hydrated).toBe(true);
  });
});

describe('bootstrapAuth', () => {
  describe('with no active session', () => {
    it('subscribes to auth changes and leaves store cleared but hydrated', async () => {
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
      const { bootstrapAuth, useAuth } = await import('./auth');

      await bootstrapAuth();

      expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(1);
      expect(supabaseMock.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
      expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
      const s = useAuth.getState();
      expect(s.session).toBeNull();
      expect(s.memberships).toEqual([]);
      expect(s.hydrated).toBe(true);
    });
  });

  describe('with empty BUILD_SHA (dev)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_SHA', '');
    });

    it('skips the SHA check entirely and populates derived state', async () => {
      const session = makeSession('u1');
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
      const profile = makeProfile({ id: 'u1', display_name: 'Dev' });
      const memberships: Membership[] = [{ household_id: 'h1', role: 'owner' }];
      mockProfileAndMemberships(profile, memberships);
      // Stale stamp must be ignored when BUILD_SHA is empty.
      localStorage.setItem(BUILD_SHA_KEY, 'stale-from-some-old-build');

      const { bootstrapAuth, useAuth } = await import('./auth');
      await bootstrapAuth();

      expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
      expect(localStorage.getItem(BUILD_SHA_KEY)).toBe('stale-from-some-old-build');
      const s = useAuth.getState();
      expect(s.session).toBe(session);
      expect(s.user?.id).toBe('u1');
      expect(s.profile).toEqual(profile);
      expect(s.memberships).toEqual(memberships);
      expect(s.hydrated).toBe(true);
    });
  });

  describe('with matching BUILD_SHA', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_SHA', 'sha-current');
    });

    it('writes the SHA on first sign-in when none stored', async () => {
      const session = makeSession('u1');
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
      mockProfileAndMemberships(makeProfile({ id: 'u1' }), []);

      const { bootstrapAuth, useAuth } = await import('./auth');
      await bootstrapAuth();

      expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
      expect(localStorage.getItem(BUILD_SHA_KEY)).toBe('sha-current');
      expect(useAuth.getState().session).toBe(session);
      expect(useAuth.getState().hydrated).toBe(true);
    });

    it('keeps state when stored SHA matches BUILD_SHA', async () => {
      localStorage.setItem(BUILD_SHA_KEY, 'sha-current');
      const session = makeSession('u1');
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
      const memberships: Membership[] = [{ household_id: 'h1', role: 'editor' }];
      mockProfileAndMemberships(makeProfile({ id: 'u1' }), memberships);

      const { bootstrapAuth, useAuth } = await import('./auth');
      await bootstrapAuth();

      expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
      expect(localStorage.getItem(BUILD_SHA_KEY)).toBe('sha-current');
      expect(useAuth.getState().session).toBe(session);
      expect(useAuth.getState().memberships).toEqual(memberships);
    });
  });

  describe('with mismatched BUILD_SHA', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_SHA', 'sha-new');
    });

    it('forces signOut, clears stored SHA, resets store, still subscribes', async () => {
      localStorage.setItem(BUILD_SHA_KEY, 'sha-old');
      const session = makeSession('u1');
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });

      const { bootstrapAuth, useAuth } = await import('./auth');
      // Pre-populate store; bootstrap should clear it on mismatch.
      useAuth.getState().setProfile(makeProfile({ display_name: 'Pre-existing' }));
      useAuth.getState().setMemberships([{ household_id: 'h-old', role: 'owner' }]);

      await bootstrapAuth();

      expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(BUILD_SHA_KEY)).toBeNull();
      // Mismatch path must short-circuit before any profile/membership refresh.
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(supabaseMock.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
      const s = useAuth.getState();
      expect(s.session).toBeNull();
      expect(s.user).toBeNull();
      expect(s.profile).toBeNull();
      expect(s.memberships).toEqual([]);
    });
  });
});

describe('subscribeAuthChanges (registered by bootstrapAuth)', () => {
  describe('with BUILD_SHA set', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_SHA', 'sha-current');
    });

    async function bootstrapWithNoSession() {
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
      const mod = await import('./auth');
      await mod.bootstrapAuth();
      return mod;
    }

    it('SIGNED_IN: writes BUILD_SHA, refreshes profile and memberships', async () => {
      const { useAuth } = await bootstrapWithNoSession();
      expect(lastAuthChangeCb).toBeTypeOf('function');

      const session = makeSession('u2');
      const profile = makeProfile({ id: 'u2', display_name: 'New' });
      const memberships: Membership[] = [{ household_id: 'h2', role: 'editor' }];
      mockProfileAndMemberships(profile, memberships);

      await lastAuthChangeCb?.('SIGNED_IN', session);

      expect(localStorage.getItem(BUILD_SHA_KEY)).toBe('sha-current');
      expect(useAuth.getState().session).toBe(session);
      expect(useAuth.getState().user?.id).toBe('u2');
      expect(useAuth.getState().profile).toEqual(profile);
      expect(useAuth.getState().memberships).toEqual(memberships);
    });

    it('SIGNED_OUT: clears stored SHA, profile, and memberships', async () => {
      const { useAuth } = await bootstrapWithNoSession();
      // Seed stamp + state, then pretend the user signs out.
      localStorage.setItem(BUILD_SHA_KEY, 'sha-current');
      useAuth.getState().setSession(makeSession('u1'));
      useAuth.getState().setProfile(makeProfile());
      useAuth.getState().setMemberships([{ household_id: 'h', role: 'owner' }]);

      await lastAuthChangeCb?.('SIGNED_OUT', null);

      expect(localStorage.getItem(BUILD_SHA_KEY)).toBeNull();
      expect(useAuth.getState().session).toBeNull();
      expect(useAuth.getState().user).toBeNull();
      expect(useAuth.getState().profile).toBeNull();
      expect(useAuth.getState().memberships).toEqual([]);
    });

    it('SIGNED_IN with no user does not write the SHA or fetch derived state', async () => {
      await bootstrapWithNoSession();
      // Edge case: SIGNED_IN with a session that has no user payload.
      const orphan = { ...makeSession('u1'), user: null } as unknown as Session;
      const fromCallsBefore = supabaseMock.from.mock.calls.length;

      await lastAuthChangeCb?.('SIGNED_IN', orphan);

      expect(localStorage.getItem(BUILD_SHA_KEY)).toBeNull();
      expect(supabaseMock.from.mock.calls.length).toBe(fromCallsBefore);
    });
  });

  describe('with empty BUILD_SHA', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_SHA', '');
    });

    it('SIGNED_IN refreshes derived state but does NOT write a SHA', async () => {
      supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
      const { bootstrapAuth, useAuth } = await import('./auth');
      await bootstrapAuth();

      const session = makeSession('u3');
      const profile = makeProfile({ id: 'u3', display_name: 'Dev User' });
      mockProfileAndMemberships(profile, []);

      await lastAuthChangeCb?.('SIGNED_IN', session);

      expect(localStorage.getItem(BUILD_SHA_KEY)).toBeNull();
      expect(useAuth.getState().profile).toEqual(profile);
    });
  });
});

describe('localStorage error handling', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_RELEASE_SHA', 'sha-current');
  });

  it('readStoredSha swallows getItem errors and treats storage as unstamped', async () => {
    const session = makeSession('u1');
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
    mockProfileAndMemberships(makeProfile({ id: 'u1' }), []);
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    const { bootstrapAuth, useAuth } = await import('./auth');
    await expect(bootstrapAuth()).resolves.toBeUndefined();

    expect(getItemSpy).toHaveBeenCalledWith(BUILD_SHA_KEY);
    // No mismatch detected — storage error is treated as "no stored SHA".
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(useAuth.getState().session).toBe(session);
  });

  it('writeStoredSha swallows setItem errors so bootstrap still completes', async () => {
    const session = makeSession('u1');
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
    mockProfileAndMemberships(makeProfile({ id: 'u1' }), []);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { bootstrapAuth, useAuth } = await import('./auth');
    await expect(bootstrapAuth()).resolves.toBeUndefined();
    expect(useAuth.getState().session).toBe(session);
    expect(useAuth.getState().hydrated).toBe(true);
  });

  it('clearStoredSha swallows removeItem errors during the mismatch path', async () => {
    vi.stubEnv('VITE_RELEASE_SHA', 'sha-new');
    localStorage.setItem(BUILD_SHA_KEY, 'sha-old');
    const session = makeSession('u1');
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session } });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage locked');
    });

    const { bootstrapAuth, useAuth } = await import('./auth');
    await expect(bootstrapAuth()).resolves.toBeUndefined();

    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().session).toBeNull();
    expect(useAuth.getState().memberships).toEqual([]);
  });
});
