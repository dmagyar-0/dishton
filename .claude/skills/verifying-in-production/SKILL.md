---
name: verifying-in-production
description: Use after a deploy lands, before telling anyone a change is live — and whenever someone reports a feature missing in production that passed locally. Verifies the real deployment: asserts the change is in the live bundle, drives the deployed site signed in at desktop and mobile with screenshots, and checks runtime state (feature-flag rows, migrations) the local seed can mask. Required by CLAUDE.md.
---

# Verifying in production

## Why this exists

Local validation passing is not evidence a change works for real users.

The local stack is seeded by `supabase/seed.sql`. **A deployed project never
runs that file.** Anything the seed sets up is therefore true in every local
check and may be false in production — and nothing in the local suite can tell
you which.

That is not hypothetical. #166 shipped the entire "save a followed household's
recipe" surface with unit tests, DB tests, E2E and a full
`validating-features-visually` run all green, while the feature was invisible in
production. `follows_enabled` was declared in `src/feature-flags/registry.ts`
and documented in `docs/15`, but the row only ever existed in `seed.sql`;
`useFeatureFlag` reads a missing row with `.maybeSingle()` and treats it as
`false`. Every gate was green and the feature was dark. The user found it on
their phone, twice, after being told it was verified.

`scripts/check-flag-registry.mjs` now fails the lint job if a runtime flag has
no migration-created row, so that exact bug cannot recur. This skill covers the
general class: **look at the real deployment.**

## Run it

```bash
# anonymous — the deploy responds and the change is really in the bundle
node scripts/verify-production.mjs --marker <new-i18n-key> --marker <new-element-id>

# signed in — walks the actual surface and screenshots it
node --env-file=<scratchpad>/smoke.env scripts/verify-production.mjs --authed \
  --marker save_link_action_to --out <scratchpad>/prodrun
```

Options: `--base <url>` (default `https://dishton.vercel.app`), `--out <dir>`,
`--marker <str>` (repeatable), `--keep-analytics`.

Exit code is non-zero if any check fails; `results.json` and the screenshots
land in `--out`.

### What it asserts

- The deployment responds and serves a JS bundle.
- **Every `--marker` appears in the live bundle.** Pick markers that only exist
  because of your change — a new i18n key, a new element id. This is proof the
  code shipped, as opposed to inferring it from a green deploy.
- At desktop (1280) and mobile (390): the app loads, no horizontal overflow, no
  raw i18n keys rendering.
- With `--authed`: sign-in works, `/households` lists the followed fixture,
  "Browse recipes" reaches it, the banner names the household without the
  personal greeting, the save control renders at `opacity: 1` **without hover**,
  and the recipe page offers "Save to".

Extend the authed walk when you ship a new surface — it is a plain Playwright
script, and a surface it never opens is a surface nobody checked.

## Two things it handles that a hand-rolled Playwright run gets wrong

**Chromium cannot reach the internet from this container.** The agent proxy
relays Node's `fetch` fine but drops the browser's own tunnels — you get
`net::ERR_CONNECTION_RESET` on every navigation, and
`$HTTPS_PROXY/__agentproxy/status` shows `ws_closed_mid_exchange` for the host.
Launch flags and retries do not fix it. The script intercepts every browser
request and fulfils it from Node instead. The page is still the real production
app over the real network; only the transport differs.

**Production analytics are live.** `app.metrics_active_users` counts
`distinct profile_id` from `app.analytics_events`, which the browser writes via
`supabase.from('analytics_events').insert(...)`. A signed-in smoke run would
therefore appear as a real user in the admin dashboard and skew a small user
base badly. The script fulfils that endpoint locally instead of forwarding it,
and reports how many writes it blocked. Only pass `--keep-analytics` if you
deliberately want them recorded.

## The smoke account

`prod-smoke@dishton.test` — profile `aaaaaaaa-0000-4000-8000-00000050c0de`.

It owns a **self-contained fixture**, so the followed-household surface can be
exercised without touching any real user's data:

| | |
|---|---|
| `bbbbbbbb-0000-4000-8000-00000050c0de` | household `Smoke Source Kitchen` (not personal) |
| `cccccccc-0000-4000-8000-00000050c0de` | recipe `Smoke Test Lemonade` inside it |
| follow | the smoke account's **personal** household follows `Smoke Source Kitchen` |

The account is a follower of that household, not a member — which is exactly the
shape the save-to-pantry surface requires. It follows itself; it has no access
to anyone else's recipes.

### Credentials: nothing is stored

There is no password in the repo, in env config, or in this skill. The durable
capability is the **Supabase connector**, which is already granted. Each run
mints a fresh password:

1. Generate a random value (`randomBytes(24).toString('base64url')` — must be
   ≥ 10 chars, see `LoginSchema` in `src/lib/forms/auth.ts`).
2. Reset it through the Supabase connector against the production project:

   ```sql
   update auth.users
      set encrypted_password = extensions.crypt('<fresh-random>', extensions.gen_salt('bf')),
          updated_at = now()
    where email = 'prod-smoke@dishton.test';
   ```

3. Write `PROD_SMOKE_EMAIL` / `PROD_SMOKE_PASSWORD` to an env file **in your
   scratchpad** and pass it with `node --env-file`.

Never put the password on a command line (it lands in shell history and trips
the credential-leakage guard) and never commit it.

Direct `auth.users` writes are not Supabase's sanctioned path — the Admin API
is, but that needs a service-role key this environment does not hold. The insert
shape mirrors `supabase/seed.sql`, which the E2E specs already sign in against,
and it works. If `SUPABASE_SERVICE_ROLE_KEY` is ever added to the environment,
switch to the Admin API.

## Reading the result

Report what you actually saw, with the screenshots. If something could not be
run — the site unreachable, credentials unavailable, a surface behind a flag
that is off — **say so explicitly**. Do not downgrade to "the local run passed";
that is the failure this skill exists to prevent.

## Removing the fixture

If the smoke account or its fixture should not live in production, delete it and
fall back to the anonymous checks (which still catch a missing bundle marker or
a broken deploy):

```sql
delete from auth.users where email = 'prod-smoke@dishton.test';
-- households, memberships, recipes and follows cascade from the profile.
```
