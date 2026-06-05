// Auth state mirror of the Supabase session.
//
// Bootstrap order:
//   1. supabase.auth.getSession()        -> setSession
//   2. force-signOut if session was minted under a different build SHA
//   3. select * from app.profiles        -> setProfile
//   4. select household_members          -> setMemberships
//   5. subscribe onAuthStateChange       -> repeat 3+4 on SIGNED_IN, clear on SIGNED_OUT

import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { clearUserContext, setHouseholdContext, setUserContext } from '../observability/sentry';
import { applyUiLanguage } from './i18n';
import { supabase } from './supabase';

// Force re-auth across deploys: a session minted under build A must not survive
// into build B. We stamp the running build's SHA into localStorage on sign-in
// and compare on bootstrap; mismatch → signOut. Empty SHA (dev) disables the
// check so local development isn't disrupted.
const BUILD_SHA = import.meta.env.VITE_RELEASE_SHA ?? '';
const BUILD_SHA_KEY = 'dishton.session.build_sha';

function readStoredSha(): string | null {
  try {
    return localStorage.getItem(BUILD_SHA_KEY);
  } catch {
    return null;
  }
}
function writeStoredSha(sha: string): void {
  try {
    localStorage.setItem(BUILD_SHA_KEY, sha);
  } catch {
    /* private mode / storage disabled */
  }
}
function clearStoredSha(): void {
  try {
    localStorage.removeItem(BUILD_SHA_KEY);
  } catch {
    /* private mode / storage disabled */
  }
}

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  locale: string;
  preferred_unit_system: 'metric' | 'imperial';
  preferred_language: string;
};

export type Membership = {
  household_id: string;
  role: 'owner' | 'editor';
  is_personal: boolean;
};

export type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  memberships: Membership[];
  hydrated: boolean;
  setSession: (s: Session | null) => void;
  setProfile: (p: Profile | null) => void;
  setMemberships: (m: Membership[]) => void;
  signOut: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  memberships: [],
  hydrated: false,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  setProfile: (profile) => set({ profile }),
  setMemberships: (memberships) => set({ memberships, hydrated: true }),
  signOut: async () => {
    await supabase.auth.signOut();
    clearUserContext();
    setHouseholdContext(null);
    set({ session: null, user: null, profile: null, memberships: [], hydrated: true });
  },
}));

export async function refreshAuthDerivedState(userId: string): Promise<void> {
  const profile = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (profile.error) {
    // A transient failure here must not be treated as "user has no profile".
    // Re-throw so the caller can decide whether to keep prior state instead of
    // silently flipping the store into a logged-out-looking shape.
    throw profile.error;
  }
  if (profile.data) {
    const loaded = profile.data as Profile;
    useAuth.getState().setProfile(loaded);
    setUserContext(loaded.id);
    // Apply the persisted interface language so a returning user lands in the
    // language they chose, not the build-time default. Narrowed to supported
    // UI languages inside applyUiLanguage.
    applyUiLanguage(loaded.preferred_language);
  }

  const memberships = await supabase
    .from('household_members')
    .select('household_id, role, households!inner(is_personal)')
    .eq('profile_id', userId);
  if (memberships.error) {
    // Likewise: do not clear memberships to [] on a transient error, which
    // would wrongly bounce the user to /onboarding. Surface it instead.
    throw memberships.error;
  }
  const rows =
    (memberships.data as Array<{
      household_id: string;
      role: 'owner' | 'editor';
      households: { is_personal: boolean } | { is_personal: boolean }[];
    }> | null) ?? [];
  // Supabase returns the joined row as either an object or single-element
  // array depending on the FK shape; normalize both forms.
  const normalized: Membership[] = rows.map((r) => {
    const join = Array.isArray(r.households) ? r.households[0] : r.households;
    return {
      household_id: r.household_id,
      role: r.role,
      is_personal: join?.is_personal ?? false,
    };
  });
  useAuth.getState().setMemberships(normalized);
}

export async function bootstrapAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();

  if (BUILD_SHA && data.session) {
    const storedSha = readStoredSha();
    if (storedSha && storedSha !== BUILD_SHA) {
      await supabase.auth.signOut();
      clearStoredSha();
      useAuth.getState().setSession(null);
      useAuth.getState().setProfile(null);
      useAuth.getState().setMemberships([]);
      subscribeAuthChanges();
      return;
    }
    writeStoredSha(BUILD_SHA);
  }

  useAuth.getState().setSession(data.session);
  if (data.session?.user) {
    try {
      await refreshAuthDerivedState(data.session.user.id);
    } catch (err) {
      // Profile/membership fetch failed transiently. We keep the restored
      // session but must still flip `hydrated` so guards stop waiting; an empty
      // memberships list here is "unknown", not "zero", so guards treat a live
      // session conservatively (see requireHousehold).
      console.error('[auth] failed to load derived state', err);
      useAuth.getState().setMemberships([]);
    }
  } else {
    useAuth.getState().setMemberships([]);
  }

  subscribeAuthChanges();
}

function subscribeAuthChanges(): void {
  supabase.auth.onAuthStateChange(async (event, session) => {
    useAuth.getState().setSession(session);
    if (event === 'SIGNED_IN' && session?.user) {
      if (BUILD_SHA) writeStoredSha(BUILD_SHA);
      try {
        await refreshAuthDerivedState(session.user.id);
      } catch (err) {
        console.error('[auth] failed to refresh derived state on sign-in', err);
        useAuth.getState().setMemberships([]);
      }
    } else if (event === 'SIGNED_OUT') {
      clearStoredSha();
      clearUserContext();
      setHouseholdContext(null);
      useAuth.getState().setProfile(null);
      useAuth.getState().setMemberships([]);
    }
  });
}
