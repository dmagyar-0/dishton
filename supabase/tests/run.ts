// supabase/tests/run.ts
// Test runner per docs/12-testing-strategy.md.
//
// 1. Read LOCAL_DB_URL (default postgresql://postgres:postgres@127.0.0.1:54322/postgres).
// 2. Reset the DB and apply every migration in supabase/migrations/.
// 3. For each *.test.sql file, run it inside a transaction, parse the result
//    set as TAP assertions (label, ok), print TAP lines, and roll back.
// 4. Exit non-zero on any failed assertion.
//
// Usage:
//   deno run -A supabase/tests/run.ts
//
// The script shells out to `psql` for both DDL application and per-file test
// execution. psql is a hard dependency; the docs assume the local Supabase
// stack (which already requires Postgres) is running.

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts';

const DB_URL =
  Deno.env.get('LOCAL_DB_URL') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const HERE = dirname(fromFileUrl(import.meta.url));
const SUPABASE_DIR = dirname(HERE);
const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

async function runPsql(
  args: string[],
  stdinText?: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const cmd = new Deno.Command('psql', {
    args: [DB_URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    stdin: stdinText !== undefined ? 'piped' : 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  const child = cmd.spawn();
  if (stdinText !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdinText));
    await w.close();
  }
  const { code, stdout, stderr } = await child.output();
  return {
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    ok: code === 0,
  };
}

async function resetDatabase(): Promise<void> {
  // Drop and recreate the app schema and any test artefacts. The auth and
  // storage schemas are managed by Supabase and we leave them alone -- the
  // CLI's `supabase db reset` is the canonical full reset; for raw psql
  // (CI without the CLI) we focus on the app surface.
  const sql = `
    drop schema if exists app cascade;
    drop function if exists public.app_reserve_ai_budget(bigint);
    drop trigger if exists on_auth_user_created on auth.users;
  `;
  const r = await runPsql(['-c', sql]);
  if (!r.ok) {
    console.error('reset failed:', r.stderr);
    Deno.exit(2);
  }
}

async function applyMigrations(): Promise<void> {
  const files: string[] = [];
  for await (const entry of walk(MIGRATIONS_DIR, { exts: ['.sql'], maxDepth: 1 })) {
    if (entry.isFile) files.push(entry.path);
  }
  files.sort();
  for (const f of files) {
    const r = await runPsql(['-f', f]);
    if (!r.ok) {
      console.error(`migration failed: ${f}`);
      console.error(r.stderr);
      Deno.exit(2);
    }
  }
}

type Assertion = { label: string; ok: boolean };

async function runTestFile(path: string): Promise<Assertion[]> {
  // Wrap the file body in BEGIN/ROLLBACK and tell psql to emit the final
  // result set as unaligned, tab-separated rows we can parse without csv lib.
  const body = await Deno.readTextFile(path);
  const wrapped = `
\\set ON_ERROR_STOP on
\\pset format unaligned
\\pset fieldsep '\t'
\\pset tuples_only on
begin;
${body}
rollback;
`;
  const r = await runPsql(['-c', wrapped]);
  if (!r.ok) {
    return [{ label: `${path} (psql error)`, ok: false }];
  }
  const lines = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Assertion[] = [];
  for (const line of lines) {
    // Skip stray notices that some plpgsql blocks may emit if any.
    const parts = line.split('\t');
    if (parts.length !== 2) continue;
    const [label, okText] = parts;
    out.push({ label, ok: okText === 't' || okText === 'true' });
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`# LOCAL_DB_URL=${DB_URL}`);

  console.log('# resetting database');
  await resetDatabase();
  console.log('# applying migrations');
  await applyMigrations();

  const testFiles: string[] = [];
  for await (const entry of walk(HERE, { exts: ['.sql'], includeDirs: false })) {
    if (entry.name.endsWith('.test.sql')) testFiles.push(entry.path);
  }
  testFiles.sort();

  let n = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const file of testFiles) {
    console.log(`# file ${file}`);
    const results = await runTestFile(file);
    if (results.length === 0) {
      n += 1;
      failed += 1;
      const msg = `not ok ${n} - ${file} produced no assertions`;
      console.log(msg);
      failures.push(msg);
      continue;
    }
    for (const a of results) {
      n += 1;
      if (a.ok) {
        console.log(`ok ${n} - ${a.label}`);
      } else {
        failed += 1;
        const msg = `not ok ${n} - ${a.label}`;
        console.log(msg);
        failures.push(msg);
      }
    }
  }

  console.log(`1..${n}`);
  if (failed > 0) {
    console.error(`# ${failed}/${n} assertions failed`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
