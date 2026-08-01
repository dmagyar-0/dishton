// @vitest-environment jsdom
//
// NOTE ON TEST RUNNER SCOPE: CLAUDE.md's `pnpm test:components` runs
// `vitest run src/ui src/lib` and `pnpm test:unit` runs `vitest run
// src/domain` -- neither directory argument includes `src/routes`, so this
// file (like every other file under src/routes) is NOT picked up by either
// script. That matches this repo's existing convention: no route file has a
// co-located test today. It is still exercised directly with
// `npx vitest run src/routes` -- see the observability Phase 3 report for
// that run's output.

import { redirect } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const authState = {
    hydrated: true,
    session: null as { user: { id: string } } | null,
  };
  const fetchIsAppAdmin = vi.fn(() => Promise.resolve(false));
  return { authState, fetchIsAppAdmin };
});

vi.mock('@/lib/auth', () => ({
  useAuth: { getState: () => mocks.authState },
}));

vi.mock('@/lib/queries/metrics', () => ({
  fetchIsAppAdmin: mocks.fetchIsAppAdmin,
}));

import { requireAppAdmin } from './_guards';

function isRedirectTo(err: unknown, to: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const options = (err as { options?: { to?: string } }).options;
  return options?.to === to;
}

describe('requireAppAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.hydrated = true;
    mocks.authState.session = null;
  });

  it('does nothing (lets the route render) while the auth store is still hydrating', async () => {
    mocks.authState.hydrated = false;
    await expect(requireAppAdmin()).resolves.toBeUndefined();
    expect(mocks.fetchIsAppAdmin).not.toHaveBeenCalled();
  });

  it('redirects a signed-out visitor to /auth/login without ever asking is_app_admin', async () => {
    mocks.authState.session = null;
    await expect(requireAppAdmin()).rejects.toSatisfy((e: unknown) =>
      isRedirectTo(e, '/auth/login'),
    );
    expect(mocks.fetchIsAppAdmin).not.toHaveBeenCalled();
  });

  it('redirects a signed-in NON-admin to / -- never rendering the dashboard', async () => {
    mocks.authState.session = { user: { id: 'p_1' } };
    mocks.fetchIsAppAdmin.mockResolvedValueOnce(false);
    await expect(requireAppAdmin()).rejects.toSatisfy((e: unknown) => isRedirectTo(e, '/'));
  });

  it('lets a real admin through (no redirect thrown)', async () => {
    mocks.authState.session = { user: { id: 'p_admin' } };
    mocks.fetchIsAppAdmin.mockResolvedValueOnce(true);
    await expect(requireAppAdmin()).resolves.toBeUndefined();
  });
});

// Sanity check that @tanstack/react-router's redirect() really does throw an
// object carrying `to` -- the assertion helper above relies on that shape.
describe('redirect() shape (sanity)', () => {
  it('throws an object with the target `to`', () => {
    try {
      throw redirect({ to: '/' });
    } catch (e) {
      expect(isRedirectTo(e, '/')).toBe(true);
    }
  });
});
