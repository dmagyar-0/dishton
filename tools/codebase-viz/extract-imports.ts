// Extracts module-level import edges from the real source tree using the
// TypeScript compiler API (no extra dependency). Regex would not survive the
// repo's `@/` alias and the `_shared/domain` symlink, so we resolve specifiers
// the same way the bundler / Deno do, then aggregate file-level imports into
// weighted edges between the module buckets defined in buckets.ts.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { bucketFor } from './buckets.ts';

export interface ExtractResult {
  edges: Map<string, { from: string; to: string; weight: number }>;
  filesByModule: Map<string, string[]>;
}

const SOURCE_ROOTS = ['src', 'supabase/functions'];
const SOURCE_EXTS = ['.ts', '.tsx'];
const EXCLUDED_FILES = new Set(['src/routeTree.gen.ts', 'src/lib/database.types.ts']);

function isTestFile(rel: string): boolean {
  return (
    rel.endsWith('.test.ts') ||
    rel.endsWith('.test.tsx') ||
    rel.endsWith('_test.ts') ||
    rel.endsWith('_test.tsx')
  );
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.isFile() && SOURCE_EXTS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function collectSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files.filter((abs) => {
    const rel = path.relative(repoRoot, abs).replaceAll('\\', '/');
    return !isTestFile(rel) && !EXCLUDED_FILES.has(rel);
  });
}

// Pull static imports, re-exports and dynamic import() specifiers from a file.
function readSpecifiers(filePath: string, text: string): string[] {
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

// Resolve an extensionless module path to a real file on disk.
function resolveExisting(candidate: string): string | null {
  for (const ext of SOURCE_EXTS) {
    const withExt = candidate + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }
  for (const ext of SOURCE_EXTS) {
    const index = path.join(candidate, `index${ext}`);
    if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

// Map an import specifier (relative or `@/` alias) to an absolute file path.
// Bare specifiers (react, zod, npm:..., https://...) return null — externals
// are represented by the curated layer, not by import edges.
function resolveSpecifier(spec: string, fromFile: string, repoRoot: string): string | null {
  let candidate: string | null = null;
  if (spec.startsWith('@/')) {
    candidate = path.join(repoRoot, 'src', spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    candidate = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  const resolved = resolveExisting(candidate);
  if (!resolved) return null;
  // Dereference symlinks (e.g. _shared/domain -> src/domain) so edge-function
  // imports of the shared domain land on their real module bucket.
  return fs.realpathSync(resolved);
}

export function extractImports(repoRoot: string): ExtractResult {
  const sourceFiles = collectSourceFiles(repoRoot);
  const realRoot = fs.realpathSync(repoRoot);

  const filesByModule = new Map<string, string[]>();
  const toRel = (abs: string): string =>
    path.relative(realRoot, fs.realpathSync(abs)).replaceAll('\\', '/');

  for (const abs of sourceFiles) {
    const rel = toRel(abs);
    const mod = bucketFor(rel);
    if (!mod) continue;
    const list = filesByModule.get(mod) ?? [];
    list.push(rel);
    filesByModule.set(mod, list);
  }

  const edges = new Map<string, { from: string; to: string; weight: number }>();
  for (const abs of sourceFiles) {
    const fromRel = toRel(abs);
    const fromMod = bucketFor(fromRel);
    if (!fromMod) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const spec of readSpecifiers(abs, text)) {
      const target = resolveSpecifier(spec, abs, repoRoot);
      if (!target) continue;
      const toMod = bucketFor(toRel(target));
      if (!toMod || toMod === fromMod) continue;
      const key = `${fromMod}->${toMod}`;
      const existing = edges.get(key);
      if (existing) existing.weight += 1;
      else edges.set(key, { from: fromMod, to: toMod, weight: 1 });
    }
  }

  for (const [, files] of filesByModule) files.sort();
  return { edges, filesByModule };
}
