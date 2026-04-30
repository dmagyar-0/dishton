// Auth state mirror of the Supabase session.
//
// Bootstrap order:
//   1. supabase.auth.getSession()        -> setSession
//   2. select * from app.profiles        -> setProfile
//   3. select household_members          -> setMemberships
//   4. subscribe onAuthStateChange       -> repeat 2+3 on SIGNED_IN, clear on SIGNED_OUT

import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from './supabase';

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
    set({ session: null, user: null, profile: null, memberships: [], hydrated: true });
  },
}));

async function refreshAuthDerivedState(userId: string): Promise<void> {
  const profile = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (profile.data) useAuth.getState().setProfile(profile.data as Profile);

  const memberships = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('profile_id', userId);
  useAuth.getState().setMemberships((memberships.data as Membership[]) ?? []);
}

export async function bootstrapAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  useAuth.getState().setSession(data.session);
  if (data.session?.user) {
    await refreshAuthDerivedState(data.session.user.id);
  } else {
    useAuth.getState().setMemberships([]);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    useAuth.getState().setSession(session);
    if (event === 'SIGNED_IN' && session?.user) {
      await refreshAuthDerivedState(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      useAuth.getState().setProfile(null);
      useAuth.getState().setMemberships([]);
    }
  });
}
