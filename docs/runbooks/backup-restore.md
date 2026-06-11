# Backup & restore

Dishton's only stateful systems are the Supabase Postgres database and the
two Storage buckets (`recipe-images`, `imports`). Everything else (Vercel
artifact, Edge Functions) is rebuilt from git on every deploy.

## What must be true in production

1. **PITR or daily backups enabled** on the Supabase project
   (Dashboard → Project Settings → Database → Backups). Free-tier projects
   get daily backups with 1-day retention only; the Pro plan adds
   point-in-time recovery. Decide the plan consciously — migrations are
   forward-only by policy (docs/13), so a botched destructive migration
   with no restore path is unrecoverable data loss.
2. **A periodic logical dump off-platform.** Platform backups protect
   against bad writes, not against losing access to the platform. Weekly:

   ```bash
   supabase link --project-ref <prod-ref>
   supabase db dump -f "dishton-$(date +%F).sql" --data-only
   supabase db dump -f "dishton-schema-$(date +%F).sql"
   ```

   Store both files somewhere that is not Supabase (encrypted local disk,
   object storage in another account). Storage objects: bucket contents
   can be mirrored with any S3-compatible sync against the project's
   storage endpoint, or skipped consciously — hero images are
   re-importable, avatars are low-value.
3. **A rehearsed restore.** A backup that has never been restored is a
   hope, not a backup. Quarterly: restore the latest dump into a scratch
   Supabase project (`supabase db reset` + `psql -f`), boot the SPA
   against it locally, and confirm sign-in + recipe list render.

## Restore procedure (data corruption / bad migration)

1. Stop deploys: disable the Deploy workflow in the Actions tab (it is
   gated on CI, but a green CI on a bad migration is exactly the failure
   mode here).
2. Snapshot current state before touching anything:
   `supabase db dump -f pre-restore-$(date +%F-%H%M).sql`.
3. Platform path: Dashboard → Database → Backups → restore (PITR to a
   timestamp if available, otherwise the most recent daily backup).
4. Off-platform path (platform unavailable): create a fresh project,
   apply `supabase/migrations/` (`supabase db push`), then load the most
   recent data dump.
5. Re-point secrets if the project ref changed (`SUPABASE_PROJECT_REF_PROD`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` GitHub secrets; Edge Function
   secrets via `supabase secrets set`), redeploy, and run the e2e smoke
   suite against the result before announcing recovery.
6. Write the incident down (what broke, data window lost, what would have
   shortened recovery).

## Known gaps (deliberate, revisit at real user volume)

- No automated off-platform dump job yet — the weekly dump is manual.
- Storage buckets are not mirrored.
- The restore drill is calendar-discipline, not automation.
