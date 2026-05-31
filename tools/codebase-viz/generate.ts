// Generator entry point: `pnpm viz`.
// Extract real import edges → merge with the curated architecture layer →
// assert invariants → inject the data blob into template.html → write the
// self-contained docs/codebase-map.html.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_TABLES,
  DOMAIN_SHAPES,
  EXTERNAL_NODES,
  FLOW_EDGES,
  LAYERS,
  PAYLOADS,
} from './architecture.ts';
import { MODULE_NODES } from './buckets.ts';
import { extractImports } from './extract-imports.ts';
import type { VizData, VizEdge, VizNode } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const templatePath = path.join(here, 'template.html');
const outputPath = path.join(repoRoot, 'docs', 'codebase-map.html');

function buildData(): VizData {
  const { edges: importEdges, filesByModule } = extractImports(repoRoot);

  // Only emit module nodes that actually contain source files.
  const nodes: VizNode[] = [];
  for (const def of MODULE_NODES) {
    const files = filesByModule.get(def.id);
    if (!files || files.length === 0) continue;
    const node: VizNode = {
      id: def.id,
      label: def.label,
      layer: def.layer,
      kind: def.kind,
      description: def.description,
      files,
    };
    if (def.id === 'mod:domain') node.details = { domainShapes: DOMAIN_SHAPES };
    const payload = PAYLOADS[def.id];
    if (payload) node.details = { ...node.details, payload };
    nodes.push(node);
  }

  // Curated external nodes (Postgres, Anthropic, Auth, Storage, oEmbed).
  for (const ext of EXTERNAL_NODES) {
    const node: VizNode = { ...ext };
    if (ext.id === 'db:tables') node.details = { dbTables: DB_TABLES };
    nodes.push(node);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Import edges (only those whose endpoints survived as nodes).
  const edges: VizEdge[] = [];
  for (const e of importEdges.values()) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    edges.push({ from: e.from, to: e.to, kind: 'import', weight: e.weight });
  }
  // Curated cross-boundary flow edges.
  for (const e of FLOW_EDGES) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    edges.push(e);
  }

  return { layers: LAYERS, nodes, edges, generatedAt: new Date().toISOString() };
}

function assertValid(data: VizData): void {
  const fail = (msg: string): never => {
    throw new Error(`viz invariant failed: ${msg}`);
  };
  if (data.nodes.length < 20 || data.nodes.length > 40) {
    fail(`expected 20-40 nodes, got ${data.nodes.length}`);
  }
  const ids = new Set(data.nodes.map((n) => n.id));
  for (const e of data.edges) {
    if (!ids.has(e.from)) fail(`edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) fail(`edge to unknown node ${e.to}`);
  }
  const domain = data.nodes.find((n) => n.id === 'mod:domain');
  if (!domain?.details?.domainShapes?.length) fail('mod:domain has no domainShapes');
  const db = data.nodes.find((n) => n.id === 'db:tables');
  if (!db?.details?.dbTables?.length) fail('db:tables has no dbTables');
  for (const id of [
    'fn:import-url',
    'fn:import-instagram',
    'fn:import-photo',
    'fn:translate-recipe',
  ]) {
    const fn = data.nodes.find((n) => n.id === id);
    if (!fn) fail(`missing function node ${id}`);
    if (!fn?.details?.payload) fail(`${id} has no payload`);
  }
}

function main(): void {
  const data = buildData();
  assertValid(data);

  const template = fs.readFileSync(templatePath, 'utf8');
  // Embedded in a <script type="application/json"> block; escape `<` so a
  // payload string can never close the script tag early.
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const html = template.replace('__VIZ_DATA__', json);
  fs.writeFileSync(outputPath, html);

  const rel = path.relative(repoRoot, outputPath);
  console.log(`Wrote ${rel} — ${data.nodes.length} nodes, ${data.edges.length} edges.`);
}

main();
