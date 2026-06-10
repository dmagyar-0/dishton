// Migration-policy gate for CI (docs/13 "Supabase migration policy").
//
// A full `supabase db diff` against a live project is not feasible in a plain
// PR runner (no production credentials, no preview branch guaranteed). Instead
// this performs the strongest *deterministic* checks we can from the git diff
// alone:
//
//   1. FORWARD-ONLY: existing files under supabase/migrations/ must never be
//      modified or deleted. A merged migration is immutable; to change schema
//      you add a new timestamped migration.
//   2. SCHEMA-CHANGE-NEEDS-MIGRATION: if the declarative schema or seed changed
//      (supabase/seed.sql, supabase/config.toml's db section is out of scope)
//      OR an existing migration was touched, there must be at least one NEWLY
//      ADDED migration file in the PR.
//
// Limitation (documented in docs/13): this cannot detect schema changes that
// were applied only to a developer's local database and never written to any
// file — there is nothing in the diff to catch. There is no preview-branch
// `supabase db diff` backstop (no preview environments exist); the practical
// backstop is `supabase db push` failing on drift during deploy. This gate
// guarantees the file-level invariants.
//
// Usage: node scripts/check-migration-diff.mjs <base-ref>
//   base-ref defaults to origin/main. The caller must have fetched it.

import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'origin/main';

function changedFiles() {
  // <base>...HEAD = changes on this branch since it diverged from base.
  const out = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [status, ...pathParts] = line.split('\t');
      // Renames look like "R100\told\tnew"; treat the new path as added and the
      // old path as deleted for our purposes.
      if (status.startsWith('R')) {
        return [
          { status: 'D', path: pathParts[0] },
          { status: 'A', path: pathParts[1] },
        ];
      }
      return [{ status: status[0], path: pathParts[0] }];
    });
}

const files = changedFiles();
const errors = [];

const isMigration = (p) => /^supabase\/migrations\/.+\.sql$/.test(p);

// Tombstoned migrations: files merged to main in a permanently un-appliable
// state, allowed to be DELETED exactly once despite the forward-only rule.
// Forward-only exists to stop edits to migrations that already ran somewhere
// (which would drift those environments); a migration that could never run
// anywhere carries no such risk. Every entry must stay justified -- see the
// "forward-only exception" note in docs/13-ci-cd-and-environments.md.
const TOMBSTONED_DELETIONS = new Set([
  // Shared the 20260606120000 timestamp with
  // 20260606120000_import_jobs_recipe_set_null.sql (#83 and #84 both used it),
  // so it collided on the schema_migrations primary key and never applied in
  // any environment. Superseded by 20260606120100_recipe_chat.sql.
  'supabase/migrations/20260606120000_recipe_chat.sql',
]);

// A tombstoned file may be removed but not modified -- only its deletion is
// exempt from the forward-only rule.
const isTombstonedDeletion = (f) => f.status === 'D' && TOMBSTONED_DELETIONS.has(f.path);

const migrationChanges = files.filter((f) => isMigration(f.path));
const addedMigrations = migrationChanges.filter((f) => f.status === 'A');
const mutatedMigrations = migrationChanges.filter(
  (f) => (f.status === 'M' || f.status === 'D') && !isTombstonedDeletion(f),
);

// Check 1: forward-only.
for (const f of mutatedMigrations) {
  errors.push(
    `Migration "${f.path}" was ${f.status === 'D' ? 'deleted' : 'modified'}; migrations are forward-only. Add a NEW migration instead.`,
  );
}

// Check 2: schema/seed changes require a new migration.
const seedChanged = files.some((f) => f.path === 'supabase/seed.sql' && f.status !== 'D');
const schemaTouched = seedChanged || mutatedMigrations.length > 0;
if (schemaTouched && addedMigrations.length === 0) {
  errors.push(
    'Schema/seed change detected (supabase/seed.sql or an existing migration) but no NEW migration file was added in this PR. Write a forward migration under supabase/migrations/.',
  );
}

if (errors.length > 0) {
  console.error('Migration policy violation:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (addedMigrations.length > 0) {
  console.log(
    `Migration check OK: ${addedMigrations.length} new migration file(s) added, none mutated.`,
  );
} else {
  console.log('Migration check OK: no schema/migration changes in this PR.');
}
