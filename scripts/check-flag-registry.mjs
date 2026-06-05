// Verifies that the feature-flag registry, the flag table in
// docs/15-roadmap-and-flags.md, and the build-time flag rows in .env.example
// all agree. Run from the repo root: `node scripts/check-flag-registry.mjs`.
//
// This is the CI guard promised in src/feature-flags/registry.ts ("CI compares
// this to the doc; mismatches fail the build"). It is intentionally
// dependency-free (plain Node, regex parsing) so it runs in the lint job
// without extra install steps.
//
// Checks:
//   1. Every flag key in registry.ts appears in the doc table.
//      - build-time flags appear via their VITE_FEATURE_* env var token.
//      - runtime flags appear via `feature_flags.<key>` or the bare key.
//   2. Every flag token named in the doc table maps back to a registry flag
//      (no doc-only / orphaned flags).
//   3. Every build-time flag's env var has a row in .env.example.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const registrySrc = read('src/feature-flags/registry.ts');
const docSrc = read('docs/15-roadmap-and-flags.md');
const envSrc = read('.env.example');

const errors = [];

// --- Parse the registry: each FlagDefinition object literal. ---
// We capture key, transport, and optional envVar from each `{ ... }` entry.
const flagBlocks = registrySrc.match(/\{[^}]*key:\s*'[^']+'[^}]*\}/g) ?? [];
const registryFlags = flagBlocks.map((block) => {
  const key = block.match(/key:\s*'([^']+)'/)?.[1];
  const transport = block.match(/transport:\s*'([^']+)'/)?.[1];
  const envVar = block.match(/envVar:\s*'([^']+)'/)?.[1] ?? null;
  return { key, transport, envVar };
});

if (registryFlags.length === 0) {
  errors.push('Could not parse any flags from src/feature-flags/registry.ts');
}

for (const flag of registryFlags) {
  if (!flag.key) errors.push('Registry flag missing a key');
  if (flag.transport === 'build-time' && !flag.envVar) {
    errors.push(`Build-time flag "${flag.key}" is missing an envVar in registry.ts`);
  }
  if (flag.transport === 'runtime' && flag.envVar) {
    errors.push(`Runtime flag "${flag.key}" should not declare an envVar in registry.ts`);
  }
}

// The doc references build-time flags by their env var and runtime flags by
// `feature_flags.<key>`; both forms also appear as bare tokens. Build the set
// of tokens we expect the doc to contain for each registry flag.
const docExpectedTokens = registryFlags.map((flag) => {
  if (flag.transport === 'build-time') return flag.envVar;
  return flag.key; // runtime: matched as the bare key (doc uses feature_flags.<key>)
});

// --- Check 1 + 3: every registry flag is reflected in the doc + env. ---
for (let i = 0; i < registryFlags.length; i++) {
  const flag = registryFlags[i];
  const token = docExpectedTokens[i];
  if (token && !docSrc.includes(token)) {
    errors.push(`Flag "${flag.key}" (token "${token}") is missing from docs/15 flag table`);
  }
  if (flag.transport === 'build-time' && flag.envVar) {
    // .env.example must declare the build-time flag's env var (any value).
    const re = new RegExp(`^${flag.envVar}=`, 'm');
    if (!re.test(envSrc)) {
      errors.push(`Build-time flag env var "${flag.envVar}" is missing from .env.example`);
    }
  }
}

// --- Check 2: no orphaned doc flags. ---
// Collect every VITE_FEATURE_* token and feature_flags.<key> token from the
// doc and ensure each maps to a registry flag.
const docViteTokens = [...docSrc.matchAll(/\bVITE_FEATURE_[A-Z0-9_]+\b/g)].map((m) => m[0]);
const docRuntimeKeys = [...docSrc.matchAll(/feature_flags\.([a-z0-9_]+)/g)].map((m) => m[1]);

const registryEnvVars = new Set(registryFlags.map((f) => f.envVar).filter(Boolean));
const registryKeys = new Set(registryFlags.map((f) => f.key));

for (const token of new Set(docViteTokens)) {
  if (!registryEnvVars.has(token)) {
    errors.push(`docs/15 references env-var flag "${token}" with no entry in registry.ts`);
  }
}
for (const key of new Set(docRuntimeKeys)) {
  if (!registryKeys.has(key)) {
    errors.push(
      `docs/15 references runtime flag "feature_flags.${key}" with no entry in registry.ts`,
    );
  }
}

if (errors.length > 0) {
  console.error('Feature-flag registry / doc drift detected:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    '\nReconcile src/feature-flags/registry.ts, docs/15-roadmap-and-flags.md, and .env.example.',
  );
  process.exit(1);
}

console.log(
  `Feature-flag registry OK (${registryFlags.length} flags in sync with docs/15 and .env.example).`,
);
