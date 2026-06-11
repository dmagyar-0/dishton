# Security & Production-Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-06-10 security/production-readiness audit: the critical household-takeover RLS hole, auth-token handling, CI/deploy pipeline gaps, AI cost metering, cache hygiene, and supply-chain pinning.

**Architecture:** Two new SQL migrations (security fixes, then advisor cleanup) with TAP tests; targeted Edge Function changes (budget refunds, chat metering, CORS allowlist, magic-byte sniffing, hero-image re-hosting through the existing SSRF guard); frontend auth/session hardening (PKCE, Sentry scrubbing, sign-out cache clearing); workflow hardening (SHA pins, least privilege, CI-gated deploys); docs that match reality.

**Tech Stack:** Postgres RLS/plpgsql, Deno Edge Functions, React/TanStack, GitHub Actions, Workbox.

---

### Task 1: Migration `20260610120000_security_hardening.sql`

**Files:**
- Create: `supabase/migrations/20260610120000_security_hardening.sql`

Contents (full):

```sql
-- 20260610120000_security_hardening.sql
-- Fixes from the 2026-06-10 security audit. Forward-only.
--
--   1. CRITICAL — household_members_self_insert allowed any authenticated user
--      to insert themselves as OWNER of ANY household (role='owner' branch had
--      no check that the caller created the household). New helper
--      app.is_household_creator ties the bootstrap branch to households the
--      caller actually owns at the table level (owner_profile_id).
--   2. import_jobs rows could carry an arbitrary household_id (cost-view
--      poisoning); with check now requires membership.
--   3. households_owner_delete allowed direct DELETE of personal households,
--      bypassing the delete_household RPC guard.
--   4. filter_household_tags was callable by any authenticated user with any
--      household id (tag-whitelist probing). Direct EXECUTE revoked; the
--      definer RPCs that call it run as the function owner and keep access.
--   5. recipe_chat_sessions.recipe_id FK blocked recipe deletion (NO ACTION);
--      now ON DELETE SET NULL. recipe_chat_* write policies split per action
--      so INSERT pins created_by/role and SELECT isn't double-evaluated.
--   6. hero_image_path was trusted verbatim from client/model input and the
--      storage read policy keys on it — an editor could "mount" any object
--      name into their read scope. save_recipe/update_recipe/promote_hero_image
--      now require null | http(s) | unchanged | caller-uid-prefixed paths.
--   7. public.app_refund_ai_budget — global-bucket refund counterpart so Edge
--      Functions can release reservations when the model call never ran.
--   8. reap_stuck_imports also deletes terminal import_jobs older than 30 days
--      (retention; the table was unbounded).
--   9. recipe_chat_sessions.agent_cycles — webhook-side metering counter.
```

Full SQL is written in the implementation (see repo file). Key definitions:

```sql
create or replace function app.is_household_creator(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.households
    where id = h and owner_profile_id = auth.uid()
  ) into result;
  return result;
end;
$$;

drop policy if exists household_members_self_insert on app.household_members;
create policy household_members_self_insert on app.household_members
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      (role = 'owner' and app.is_household_creator(household_id))
      or app.is_household_owner(household_id)
    )
  );

drop policy if exists import_jobs_self on app.import_jobs;
create policy import_jobs_self on app.import_jobs
  for all using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and app.is_household_member(household_id)
  );

drop policy if exists households_owner_delete on app.households;
create policy households_owner_delete on app.households
  for delete using (app.is_household_owner(id) and is_personal = false);

revoke execute on function app.filter_household_tags(uuid, jsonb) from authenticated;

alter table app.recipe_chat_sessions
  drop constraint recipe_chat_sessions_recipe_id_fkey,
  add constraint recipe_chat_sessions_recipe_id_fkey
    foreign key (recipe_id) references app.recipes(id) on delete set null;

alter table app.recipe_chat_sessions
  add column agent_cycles integer not null default 0;

-- split write policies (sessions + messages) into insert/update/delete;
-- insert pins created_by = auth.uid() (sessions) / role in ('user','agent') stays a CHECK.

-- hero-path guard helper:
create or replace function app.is_safe_hero_image_path(p_path text, p_current text default null)
returns boolean language sql stable
set search_path = app, public
as $$
  select p_path is null
      or p_path ~ '^https?://'
      or (p_current is not null and p_path = p_current)
      or p_path like (select auth.uid())::text || '/%';
$$;
-- save_recipe / update_recipe / promote_hero_image redefined to call it
-- (raise 'invalid_hero_image_path' on failure).

create or replace function public.app_refund_ai_budget(p_tokens bigint)
returns void language plpgsql security definer
set search_path = app, public
as $$
begin
  update app.ai_rate_budget
     set tokens_used = greatest(0, tokens_used - p_tokens)
   where window_started_at >= now() - interval '60 seconds';
end;
$$;
revoke all on function public.app_refund_ai_budget(bigint) from public, anon, authenticated;
grant execute on function public.app_refund_ai_budget(bigint) to service_role;

-- reap_stuck_imports: existing UPDATE plus
--   delete from app.import_jobs
--    where status in ('done','failed','needs_review')
--      and coalesce(completed_at, created_at) < now() - interval '30 days';
```

- [ ] Step 1: write migration file
- [ ] Step 2: run `pnpm test:db` equivalent (Task 3 sets up Postgres via Docker) — failing first run acceptable until tests added
- [ ] Step 3: commit `fix(db): close household-takeover hole + harden RLS/RPC surfaces`

### Task 2: DB tests `supabase/tests/security_hardening.test.sql`

TAP-style like production_readiness.test.sql. Personas O (owner PH1), M (editor PH1), X (owner PH2, outsider). Assertions:
1. X inserting `(PH1, X, 'owner')` into household_members → 0 rows / error (takeover blocked).
2. O bootstrap-inserting owner row into a household O created → succeeds.
3. X inserting import_jobs with `household_id = PH1` → blocked; own household → ok.
4. O direct `delete from app.households where id = PP (personal)` → 0 rows; RPC path unchanged.
5. M `save_recipe` with `hero_image_path = '<X-uid>/secret.jpg'` → raises invalid_hero_image_path; with own-uid path and http URL → ok; update_recipe keeps an existing foreign path when unchanged.
6. Deleting a recipe referenced by a chat session → recipe_id set null, session survives.
7. `select app.filter_household_tags(...)` as authenticated → permission denied.

- [ ] Step 1: write test, run via `deno run -A supabase/tests/run.ts` against dockerized Postgres 17 (stub schemas applied)
- [ ] Step 2: commit with Task 1.

### Task 3: Migration `20260610120100_advisor_cleanup.sql`

- Recreate the 8 remaining `auth_rls_initplan`-flagged policies with `(select auth.uid())`: profiles_self_read/insert/update, profiles_co_member_read, household_members_self_read, households_owner_read, households_authenticated_insert, household_invites_owner_insert (read current texts from migrations before rewriting).
- `alter function ... set search_path` for: app.set_updated_at (''), app.normalize_quantity (''), app.quantity_jsonb_to_numeric (''), app.is_valid_household_tags, app.recipes_search_refresh, app.recipes_touch_for_search (app, public — read bodies first).
- FK covering indexes: import_jobs(household_id), import_jobs(recipe_id), recipe_chat_sessions(created_by), recipe_chat_sessions(recipe_id), recipes(created_by), household_invites(created_by), household_invites(redeemed_by), household_follow_codes(created_by).
- Comment documenting the accepted multiple_permissive_policies warnings for read+write policy pairs not touched here.

- [ ] commit `perf(db): advisor cleanup — initplan, search_path pins, FK indexes`

### Task 4: Edge — budget refunds

**Files:** `supabase/functions/_shared/ai/rate-budget.ts`, call sites `import-url/index.ts`, `import-photo/index.ts`, `import-instagram/index.ts`, `translate-recipe/index.ts`.

- `withRateBudget`: wrap `fn()` in try/catch → on throw, best-effort refund profile+global, rethrow.
- Export `refundBudgets(profileId, tokens)` calling `app_refund_profile_ai_budget` + `app_refund_ai_budget`.
- Call sites: when `result.ok === false && result.reason === 'upstream'` → `await refundBudgets(profileId, estimate)` (model never produced work).

- [ ] deno tests pass; commit `fix(fn): refund AI budget reservations when the model call fails`

### Task 5: Edge — recipe-chat metering + membership pre-checks

**Files:** `_shared/auth.ts` (add `assertHouseholdMember`), `recipe-chat-webhook/handler.ts`, `recipe-chat-send/handler.ts`, import functions.

- `assertHouseholdMember(client, householdId)`: select own membership row via RLS; throw `HttpError(403,'not_household_member')` when absent. Call in import-url/photo/instagram + recipe-chat-send before any job/session insert.
- Webhook on `session.status_idled`: increment `agent_cycles`; if `> MAX_AGENT_CYCLES (24)` → status 'error', agent message, `archiveSession`, 204. Otherwise `withRateBudget(session.created_by, CYCLE_TOKENS 1500, async () => true)`; on rate_limit → same termination path with budget message. Select `created_by, agent_cycles` in the session query.

- [ ] deno tests pass; commit `fix(fn): meter webhook-driven agent cycles + explicit household membership checks`

### Task 6: Edge — CORS allowlist

`corsHeaders(origin)` consults optional `ALLOWED_ORIGINS` env (comma-separated). Unset → current reflect (local/dev). Set → echo origin only if listed, else first entry. Add to env.ts OPTIONAL. Unit test in `_shared/_test.ts` style with explicit allowlist parameter.

- [ ] commit `fix(fn): validate Origin against ALLOWED_ORIGINS allowlist`

### Task 7: Edge — magic-byte sniffing (import-photo)

New `_shared/scrape/image-bytes.ts`: `sniffImageContentType(bytes: Uint8Array): 'image/jpeg'|'image/png'|'image/webp'|'image/avif'|null` (JPEG ffd8ff, PNG 89504e47, WEBP RIFF....WEBP, AVIF ftypavif) + unit test. import-photo: after signing, fetch first 32 bytes (Range) of each object and require sniffed type ∈ allowed set; keep metadata size check.

- [ ] commit `fix(fn): verify uploaded photos by magic bytes, not client-declared MIME`

### Task 8: Edge — re-host remote hero images

New `_shared/scrape/rehost-image.ts`:

```ts
rehostRemoteHeroImage(storageClient, profileId, url): Promise<string | null>
```
safeFetch (SSRF-guarded, 10s timeout) → content-type ∈ {jpeg,png,webp,avif} → streamed ≤ 4.5MB → sniff bytes → upload `recipe-images/${profileId}/${uuid}.${ext}` via caller-scoped client (own-folder storage RLS) → return path; null on any failure. Wire into import-url + import-instagram `work()` after a successful AI result: replace remote `draft.hero_image_path` with hosted path or null. Skip in mock mode.

- [ ] commit `fix(fn): re-host model-emitted hero images into the private bucket`

### Task 9: Frontend — PKCE + Sentry scrubbing

- `src/lib/supabase.ts`: `auth: { …, flowType: 'pkce' }`.
- `src/observability/sentry.ts`: export `scrubUrl(url: string): string` (drop `#…`, redact code/token/access_token/refresh_token query values); wire `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`. Unit test `src/observability/sentry.test.ts` for scrubUrl.

- [ ] `pnpm test:unit` passes; commit `fix(auth): PKCE flow + scrub tokens from Sentry URLs`

### Task 10: Frontend — sign-out & SW cache hardening

- `src/lib/auth.ts`: `registerQueryClient(qc)` (module-level); `clearUserScopedState()` = caches + queryClient.clear() + Sentry clears; call from signOut (in `finally`, signOut scope 'local'), SIGNED_OUT handler, and the stale-SHA branch (before subscribe). `src/main.tsx`: registerQueryClient(queryClient); bootstrap `.catch` → setSession(null)+setMemberships([]) so guards fail closed.
- `vite.config.ts`: remove `backgroundSync` from /rest/ route; recipe-images cache `maxAgeSeconds: 3600, maxEntries: 60`.
- `src/ui/primitives/RecipeImage.tsx`: `crossOrigin="anonymous"` so cached responses aren't opaque-padded.

- [ ] commit `fix(auth): clear all user-scoped caches on every sign-out path`

### Task 11: Frontend — misc lows

- `src/lib/forms/import.ts`: `.refine((u) => /^https?:\/\//i.test(u))` on url.
- Toasts: `import.tsx` handleSubmit + `edit.tsx` catch → keep `recipe_edit_conflict` branch; otherwise generic copy + `logErrorBreadcrumb('save_failed', { detail })`.
- `update-password.tsx`: rewrite stale comment to documented behavior (any authenticated session may update password — Supabase default; recovery link is the entry path).

- [ ] commit `fix(ui): generic error toasts + http(s)-only import URLs`

### Task 12: Workflows

- All 3 workflows: `permissions: { contents: read }`; SHA-pin actions (checkout v4 `34e11487…`, setup-node v4 `49933ea5…`, cache v4 `0057852b…`, upload-artifact v4 `ea165f8d…`, setup-deno v1.5.2 `11b63cf7…`, setup-cli pinned tag SHA + explicit CLI version).
- ci.yml: gate greps `failure|cancelled|skipped`, `needs` += setup; build job gains bundle secret-scan step (`grep -rE 'sk-ant-|whsec_|SUPABASE_SERVICE_ROLE_KEY|SENTRY_AUTH_TOKEN' dist/` must find nothing); test-db image postgres:17.
- deploy.yml: trigger `workflow_run` (CI completed, success, main) with `ref: head_sha` checkout; `concurrency: deploy-production`; SENTRY_AUTH_TOKEN scoped to its step (`if: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}`); same secret-scan against `.vercel/output`; post-deploy smoke: capture `vercel deploy` URL, `curl -fsS` expect 200 + `id="root"`.
- New `.github/dependabot.yml` (npm + github-actions, weekly).

- [ ] commit `ci: least-privilege tokens, SHA pins, skipped-job gate, CI-gated serialized deploy + smoke`

### Task 13: Supply chain & config

- `supabase/functions/deno.json`: exact pins `npm:zod@3.25.76`, `npm:@noble/hashes@1.8.0/...`, `jsr:@std/assert@^1` → pin exact too; drop `"lock": false`; generate `supabase/functions/deno.lock` (deno cache).
- `pnpm remove husky lint-staged tsx`; `pnpm update ws` (≥8.20.1).
- `vercel.json`: CSP connect-src pinned to `https://hdfpnxjxrcupuxrgrnpf.supabase.co` + wss equivalent.
- `supabase/config.toml`: `major_version = 17`.

- [ ] `pnpm install` + typecheck still green; commit `chore(deps): pin function deps, drop dead tooling, patch ws, pin CSP + PG17`

### Task 14: Docs

- New `docs/runbooks/backup-restore.md`: enable PITR (dashboard), weekly logical dump fallback, quarterly restore drill, retention.
- New `docs/runbooks/alerting.md`: Better Stack drain queries (`event=request.error`, `kind=ai_call ok=false`), what exists vs. dashboard-config; frontend Sentry note.
- `docs/14-observability.md`: replace unimplemented claims (Edge Sentry, slo_snapshots, /admin/cost) with actual posture + pointer to runbook.
- `docs/13-ci-cd-and-environments.md`: remove preview-env fiction; describe workflow_run-gated deploy, concurrency, smoke, secret-scan gate.

- [ ] commit `docs: truthful observability/CI docs + backup & alerting runbooks`

### Task 15: Verification

- `pnpm typecheck && pnpm lint`
- `pnpm test:unit`, `pnpm test:components`, `pnpm test:edge`
- DB tests: dockerized postgres:17 + stub schemas + `deno run -A supabase/tests/run.ts`
- `pnpm build`
- Visual validation per `validating-features-visually` for the auth + sign-out flow (PKCE change is user-facing)
- Push branch `claude/admiring-maxwell-rg2r4w`

### Out of scope (dashboard/console actions — documented, not executable from repo)
- Enable HaveIBeenPwned leaked-password protection; verify email confirmations in prod Auth settings.
- Enable PITR / confirm plan tier.
- Configure Better Stack alert rules; set `ALLOWED_ORIGINS` function secret.
