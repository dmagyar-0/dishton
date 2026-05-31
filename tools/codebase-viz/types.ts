// Shared types for the codebase visualization data blob emitted by generate.ts
// and consumed by the inline viewer in template.html.

export type Layer = 'browser' | 'edge' | 'postgres' | 'external';

export type NodeKind = 'module' | 'function' | 'db' | 'external';

export type EdgeKind = 'import' | 'flow';

export interface FnResponse {
  status: number;
  shape: unknown;
  note?: string;
}

export interface FnPayload {
  request: unknown;
  responses: FnResponse[];
}

export interface DomainShape {
  name: string;
  summary: string;
}

export interface DbTable {
  name: string;
  columns: string[];
  rls: string;
}

export interface NodeDetails {
  payload?: FnPayload;
  domainShapes?: DomainShape[];
  dbTables?: DbTable[];
}

export interface VizNode {
  id: string;
  label: string;
  layer: Layer;
  kind: NodeKind;
  description?: string;
  files: string[];
  details?: NodeDetails;
}

export interface VizEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight?: number;
  label?: string;
}

export interface VizLayer {
  id: Layer;
  label: string;
  order: number;
}

export interface VizData {
  layers: VizLayer[];
  nodes: VizNode[];
  edges: VizEdge[];
  generatedAt: string;
}
