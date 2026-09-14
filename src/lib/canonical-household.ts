import type { Membership } from './auth';

// The canonical household for actions that need exactly one target when a
// user belongs to several: prefer the personal household, else the first
// membership. Originally the /households page's rule for the follow-code
// redeem target and the followed/follower lists; now shared by the
// /f/<code> follow-link landing page (its follower household) and the
// pantry-links "save to my pantry" target, so all three agree on the same
// household — mirrors AppShell's rule for header links.
export function pickCanonicalHousehold(memberships: Membership[]): Membership | undefined {
  return memberships.find((m) => m.is_personal) ?? memberships[0];
}

// Resolve which household a "manage one of mine" surface is scoped to: the
// explicit pick when it is still one of the user's memberships, else the
// canonical one. Guarding the pick matters because memberships can change
// under a stale selection (leaving a household, a membership list that
// arrives after first paint) — falling back beats scoping the page to a
// household the user is no longer in.
export function resolveManagedHousehold(memberships: Membership[], picked?: string): string {
  if (picked && memberships.some((m) => m.household_id === picked)) return picked;
  return pickCanonicalHousehold(memberships)?.household_id ?? '';
}
