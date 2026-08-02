# Shareable follow links

Status: approved 2026-08-02

## Problem

Following a household is the only sharing primitive in Dishton that still
requires an out-of-band code exchange. The owner presses "Generate follow
code", gets `f_XXXXXXXXXXXX`, and has to tell the other person to paste it
into a text field on the Households page.

Every neighbouring feature already has a link:

- Member invites — `InviteCodeDialog` offers "Copy link" → `/onboarding?code=…`
- Public recipes — `ShareDialog` offers a `/r/<token>` URL

Follow codes should work the same way: copy a link, send it, the recipient
taps it and follows.

## Decisions

Three choices were settled during brainstorming:

1. **Dedicated landing page**, not a prefilled field. The recipient sees
   *whose* household they are about to follow before they commit.
2. **Signed-out visitors are supported.** The link survives sign-up/login and
   completes the follow afterwards.
3. **Links are multi-use until revoked or expired.** Today a follow code is
   deleted on redemption; a link that dies after the first friend uses it is
   not a shareable link.

Decision 3 is a deliberate loosening. Previously a leaked code burned after
one use; afterwards it stays live for up to 30 days. Mitigations: the existing
owner-only revoke (which becomes the real off-switch), the unchanged 30-day
expiry, and the expiry countdown already rendered on the code card. The UI copy
must change to state this plainly.

## SQL

One forward-only migration: `supabase/migrations/20260802120000_follow_links.sql`.

### `app.add_follow(p_code text, p_follower_household uuid)` — multi-use

`create or replace` over the body from `20260605120500_add_follow_household_param.sql`,
identical except the final statement is removed:

```sql
delete from app.household_follow_codes where code = p_code;  -- DELETED
```

Everything else is unchanged and still required:

- `not_authenticated` when `auth.uid()` is null
- `not_household_owner` unless the caller owns `p_follower_household`
- `invalid_or_expired_follow_code` when no live code matches
- `cannot_follow_self` when follower and followed are the same household
- `insert … on conflict do nothing`, so redeeming twice is a no-op
- returns the followed household id

The signature does not change, so no `drop function` and no PostgREST
overload churn.

### `app.peek_follow_code(p_code text) returns jsonb` — new

`language plpgsql stable security definer`, `set search_path = app, public`.

Returns `jsonb_build_object('household_id', h.id, 'household_name', h.name)`
for a code whose `expires_at > now()`, and SQL `null` for anything else —
unknown code, expired code, revoked code. Callers cannot distinguish those
cases.

```sql
revoke all on function app.peek_follow_code(text) from public;
grant execute on function app.peek_follow_code(text) to anon, authenticated, service_role;
```

`anon` needs it so the landing page can name the household to a visitor who
has no account yet. The exposure is one household name to a party already
holding a 60-bit secret; that secret independently grants full follow access,
so the RPC leaks strictly less than the code itself. Enumeration of a 12-char
base32 space is not practical. No feature flag — unlike `public_recipe_shares`
this exposes no recipe content.

## Routes and UI

### `/f/$code` — new public landing route

`src/routes/f/$code.tsx` (route shell) + `src/ui/household/FollowLinkPage.tsx`
(component, colocated test). No `beforeLoad` guard — the code in the URL is the
credential, exactly as `/r/$token` treats its token.

`src/routes/__root.tsx` currently skips the `AppShell` for `routeId`s starting
`/r/`. Extend that check to `/f/` as well: a signed-out visitor has no
memberships, so the shell's nav and imports provider have nothing to render.

The page resolves the code via `peek_follow_code`, then renders one of:

| State | Render |
|---|---|
| Code invalid / expired / revoked | Explanatory message, link to home. No dead end. |
| Signed out | Household name + "Sign up to follow" and "Log in", both carrying `?next=/f/<code>` |
| Signed in, not yet following | Household name + Follow button → `add_follow` → navigate to `/h/<followedId>` |
| Signed in, already following | "You already follow X" + link to `/h/<followedId>` |
| Signed in, own household | "This is your own household" + link home |

The follower household is the canonical one `/households` already picks:
`memberships.find(m => m.is_personal) ?? memberships[0]`. Because that rule is
now used in two places it moves into a small shared helper rather than being
duplicated. No household picker.

"Already following" and "own household" are both derived client-side from the
auth store and `useFollowedHouseholds`; neither needs a new query.

### Auth round-trip: the `next` search param

`src/routes/auth/login.tsx` and `src/routes/auth/signup.tsx` gain an optional
`next` search param. On a successful session they navigate to `next` instead of
`/`. Signup threads it through `emailRedirectTo` as
`${origin}/auth/callback?next=<next>`, and `src/routes/auth/callback.tsx`
honours it in place of its hardcoded `/` (the recovery branch keeps priority).

`next` is sanitized by a single shared helper — a same-origin path only:

- must match `/^\/[^/\\]/` — leading slash, second character neither `/` nor `\`
- rejects `//evil.com`, `/\evil.com`, and any absolute URL
- anything rejected falls back to `/`

This is a general mechanism, not follow-specific, and is the piece most worth
unit-testing.

### Sharing UI

`FollowCodeCard` inside `src/ui/household/SharingSection.tsx` gets **Copy link**
as the primary action with **Copy code** retained as secondary, mirroring
`InviteCodeDialog`'s two-button footer. The link is
`${window.location.origin}/f/${code}`, built by the same shared helper the page
uses, guarded for `typeof window === 'undefined'` as `buildShareLink` already
is.

The `household_settings.sharing.redeem_hint` string changes from single-use
wording to state that anyone holding the link can follow until the owner
revokes it. New and changed strings land in all three locales:
`src/lib/i18n.en.ts`, `.de.ts`, `.hu.ts`.

## Testing

- `supabase/tests/follow_links.test.sql` — the code survives redemption; a
  second household redeems the same code successfully; expired and revoked
  codes raise `invalid_or_expired_follow_code`; self-follow still raises
  `cannot_follow_self`; a non-owner still raises `not_household_owner`;
  `peek_follow_code` returns null for unknown and expired codes and the right
  name for a live one.
- `src/ui/household/FollowLinkPage.test.tsx` — the five render states above.
- Unit test for the `next` sanitizer, including the `//evil.com` and
  backslash cases.
- `src/ui/household/SharingSection.test.tsx` — extend for the copy-link action.
- Add a `/f/<code>` capture step to `.claude/skills/design-synch/capture.spec.ts`
  per CLAUDE.md, so the new surface appears in the design snapshot.
- `validating-features-visually` before the work is called complete, per
  CLAUDE.md.

## Out of scope

- Changing the 30-day expiry, or per-link expiry control.
- A "revoke after first use" toggle. Offered during brainstorming, declined —
  revoke plus expiry is the control surface.
- Any change to member invites or `/onboarding?code=`.
