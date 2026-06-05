// Import-flow Sentry breadcrumbs. Every step pushes a `category: 'import'`
// breadcrumb so an exception thrown anywhere in the flow surfaces with full
// context. Each payload is < 256 bytes — recipe content is never captured.

import * as Sentry from '@sentry/react';

export type ImportKind = 'url' | 'instagram' | 'photo' | 'manual';

export function bcImportStart(kind: ImportKind): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.start',
    level: 'info',
    data: { kind },
  });
}
export function bcImportInputValidated(meta: Record<string, number | string>): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.input.validated',
    level: 'info',
    data: meta,
  });
}
export function bcImportRequestSent(fn: string, requestId: string): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.request.sent',
    level: 'info',
    data: { function: fn, request_id: requestId },
  });
}
export function bcImportResponseReceived(latencyMs: number, status: number): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.response.received',
    level: 'info',
    data: { latency_ms: latencyMs, status },
  });
}
export function bcImportDraftParsed(ingredients: number, steps: number): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.draft.parsed',
    level: 'info',
    data: { ingredient_count: ingredients, step_count: steps },
  });
}
export function bcImportDraftEdited(fields: string[]): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.draft.edited',
    level: 'info',
    data: { fields: fields.slice(0, 10) },
  });
}
export function bcImportDraftSaved(recipeId: string): void {
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.draft.saved',
    level: 'info',
    data: { recipe_id: recipeId },
  });
}
export function bcImportSaveFailed(meta: {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
}): void {
  // RPC failures after a successful edge-function response are the dark spot
  // in our observability — the import looks "successful" server-side, the
  // user sees a generic toast, and we have nothing to triage. Capture the
  // PostgREST error envelope verbatim. No recipe content is included.
  const data = {
    code: meta.code?.slice(0, 64) ?? null,
    message: meta.message?.slice(0, 240) ?? null,
    details: meta.details?.slice(0, 240) ?? null,
    hint: meta.hint?.slice(0, 240) ?? null,
  };
  Sentry.addBreadcrumb({
    category: 'import',
    message: 'import.save.failed',
    level: 'error',
    data,
  });
  // Also surface this as a real exception so it shows up in the Sentry issue
  // stream (not just as a breadcrumb on some later error). The breadcrumb
  // trail above is attached automatically.
  Sentry.captureException(
    new Error(`import save failed: ${data.code ?? data.message ?? 'unknown'}`),
    { extra: data, tags: { 'import.stage': 'save' } },
  );
}
