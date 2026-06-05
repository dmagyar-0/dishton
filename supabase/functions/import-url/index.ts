// import-url: paste a blog/article URL → JSON-LD scrape + lightStripHtml →
// Anthropic → validated draft Recipe + import_jobs row.
//
// The edge function never writes to app.recipes; the SPA does that on save.
// Sync mode: worker writes status='done', the SPA's response handler calls
// save_recipe directly. Background mode: worker writes status='awaiting_save'
// and the SPA's Realtime listener calls save_recipe. The status-vs-mode split
// keeps the listener idempotent — it never auto-saves a sync-mode import.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { parseHTML } from 'npm:linkedom@0.18';
import { z } from 'zod';
import {
  HttpError,
  corsHeaders,
  getCallerPreferredLanguage,
  getHouseholdAllowedTags,
  jsonResponse,
  resolveCaller,
} from '../_shared/auth.ts';
import { callAndValidate } from '../_shared/ai/validate.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { structuringFromHtml } from '../_shared/ai/prompts.ts';
import { extractRecipeJsonLd } from '../_shared/scrape/recipe-jsonld.ts';
import { SsrfError, safeFetch } from '../_shared/scrape/ssrf-guard.ts';
import { lightStripHtml } from '../_shared/scrape/strip-html.ts';
import { decodeHtmlBody } from '../_shared/scrape/decode-body.ts';
import { runWithBackgroundDetach } from '../_shared/import-runner.ts';
import { log, logAiCall } from '../_shared/log.ts';

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

const MAX_BYTES = 5_000_000;
const FIRST_RESPONSE_MS = 10_000;
const CONCURRENCY_CAP = 5;

async function fetchHtml(url: string): Promise<string> {
  // safeFetch resolves + vets the host (and every redirect hop) against the
  // SSRF guard before connecting; a private/loopback/link-local target throws
  // SsrfError, which we map to a 400 invalid_url so the SPA can tell the user
  // the link can't be imported (vs. a transient 502 they'd retry).
  let res: Response;
  try {
    res = await safeFetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'DishtonBot/0.1 (+https://dishton.app)' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    if (e instanceof SsrfError) throw new HttpError(400, 'invalid_url', { reason: e.reason });
    throw e;
  }
  if (!res.ok) throw new HttpError(502, 'fetch_failed', { status: res.status });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) throw new HttpError(415, 'not_html');
  const reader = res.body?.getReader();
  if (!reader) throw new HttpError(502, 'empty_body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_BYTES) throw new HttpError(413, 'source_too_large');
      chunks.push(value);
    }
  }
  return decodeHtmlBody(concat(chunks), ct);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const c of chunks) {
    out.set(c, i);
    i += c.length;
  }
  return out;
}

type AiUsage = { input: number; output: number; cache_read?: number; cache_write?: number };
type WorkResult =
  | {
      ok: true;
      draft: Record<string, unknown>;
      usage: AiUsage;
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      reason: 'parse' | 'schema' | 'rate_limit' | 'upstream';
      raw: string | null;
      latencyMs: number;
    };

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const requestId = crypto.randomUUID();
  const t0 = performance.now();
  let caller: Awaited<ReturnType<typeof resolveCaller>> | null = null;
  let jobId: string | null = null;
  try {
    caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    log({
      request_id: requestId,
      profile_id: caller.profileId,
      household_id: body.household_id,
      function: 'import-url',
      event: 'request.start',
    });

    await caller.client.rpc('reap_stuck_imports');

    const { count } = await caller.client
      .from('import_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', caller.profileId)
      .in('status', ['queued', 'running', 'awaiting_save']);
    if ((count ?? 0) >= CONCURRENCY_CAP) throw new HttpError(409, 'too_many_imports');

    const { data: job, error: jobErr } = await caller.client
      .from('import_jobs')
      .insert({
        profile_id: caller.profileId,
        household_id: body.household_id,
        kind: 'url',
        status: 'running',
        phase: 'scrape',
        payload: { url: body.url },
      })
      .select('id')
      .single();
    if (jobErr || !job) throw new HttpError(500, 'job_insert_failed');
    jobId = job.id as string;

    const targetLanguage = await getCallerPreferredLanguage(caller.client, caller.profileId);
    const allowedTags = await getHouseholdAllowedTags(caller.client, body.household_id);

    const callerClient = caller.client;
    const callerProfileId = caller.profileId;
    const callerHouseholdId = body.household_id;

    const work = async (): Promise<WorkResult> => {
      const html = await fetchHtml(body.url);
      const dom = parseHTML(html);
      const scraped = extractRecipeJsonLd(dom.document);
      const stripped = lightStripHtml(html);
      log({
        request_id: requestId,
        profile_id: callerProfileId,
        household_id: callerHouseholdId,
        function: 'import-url',
        event: 'scrape.jsonld',
        found: scraped !== null,
      });

      await callerClient
        .from('import_jobs')
        .update({ phase: 'ai', progress_text: 'Asking the model' })
        .eq('id', jobId);

      const budget = await withRateBudget(callerProfileId, 4000, () =>
        callAndValidate({
          lane: 'text',
          messages: structuringFromHtml({
            html: stripped,
            sourceUrl: body.url,
            scraped,
            targetLanguage,
            allowedTags,
          }),
          estimatedTokens: 4000,
        }),
      );
      const latencyMs = Math.round(performance.now() - t0);

      if (budget.status === 'rate_limit') {
        log({
          request_id: requestId,
          profile_id: callerProfileId,
          household_id: callerHouseholdId,
          function: 'import-url',
          event: 'rate_budget.deny',
          level: 'warn',
        });
        return { ok: false, reason: 'rate_limit', raw: null, latencyMs };
      }

      const result = budget.value!;
      if (!result.ok) {
        logAiCall({
          request_id: requestId,
          function: 'import-url',
          lane: 'text',
          model: '(unknown)',
          ms: latencyMs,
          tokens_in: 0,
          tokens_out: 0,
          ok: false,
          reason: result.reason,
        });
        return { ok: false, reason: result.reason, raw: result.raw, latencyMs };
      }

      logAiCall({
        request_id: requestId,
        function: 'import-url',
        lane: 'text',
        model: result.model,
        ms: latencyMs,
        tokens_in: result.usage.input,
        tokens_out: result.usage.output,
        cache_read: result.usage.cache_read,
        cache_write: result.usage.cache_write,
        ok: true,
      });

      return {
        ok: true,
        draft: { ...result.recipe, source_type: 'url' as const, source_url: body.url },
        usage: result.usage,
        model: result.model,
        latencyMs,
      };
    };

    const onFinish = async (value: WorkResult, mode: 'sync' | 'background'): Promise<void> => {
      if (!value.ok) {
        if (value.reason === 'rate_limit' || value.reason === 'upstream') {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'failed',
              error: value.reason,
              payload: { url: body.url, latency_ms: value.latencyMs },
            })
            .eq('id', jobId);
          return;
        }
        await callerClient
          .from('import_jobs')
          .update({
            status: 'needs_review',
            payload: {
              url: body.url,
              raw_model_output: value.raw,
              reason: value.reason,
              latency_ms: value.latencyMs,
            },
          })
          .eq('id', jobId);
        return;
      }
      const terminalStatus = mode === 'sync' ? 'done' : 'awaiting_save';
      await callerClient
        .from('import_jobs')
        .update({
          status: terminalStatus,
          phase: 'saving',
          progress_text: 'Saving recipe',
          payload: {
            url: body.url,
            draft: value.draft,
            tokens_in: value.usage.input,
            tokens_out: value.usage.output,
            latency_ms: value.latencyMs,
          },
        })
        .eq('id', jobId);
    };

    const onError = async (err: unknown): Promise<void> => {
      const reason = err instanceof HttpError ? err.message : 'internal';
      await callerClient
        .from('import_jobs')
        .update({ status: 'failed', error: reason })
        .eq('id', jobId);
    };

    const detach = await runWithBackgroundDetach<WorkResult>({
      firstResponseMs: FIRST_RESPONSE_MS,
      work,
      onFinish,
      onError,
    });

    if (detach.mode === 'background') {
      log({
        request_id: requestId,
        profile_id: caller.profileId,
        household_id: body.household_id,
        function: 'import-url',
        event: 'background.detach',
      });
      return jsonResponse(
        { job_id: jobId, status: 'running', request_id: requestId },
        202,
        cors,
      );
    }

    const value = detach.value;
    if (!value.ok) {
      if (value.reason === 'rate_limit') {
        return jsonResponse(
          { error: 'rate_limit', retry_after: 60, request_id: requestId },
          429,
          cors,
        );
      }
      if (value.reason === 'upstream') {
        // Transient model/API failure — not a content problem. 503 so the SPA
        // surfaces "importer busy, try again" rather than the needs_review
        // "edit the draft" copy.
        return jsonResponse(
          { error: 'upstream', request_id: requestId },
          503,
          cors,
        );
      }
      return jsonResponse(
        {
          job_id: jobId,
          draft: null,
          needs_review: true,
          reason: value.reason,
          request_id: requestId,
        },
        200,
        cors,
      );
    }

    return jsonResponse(
      { job_id: jobId, draft: value.draft, needs_review: false, request_id: requestId },
      200,
      cors,
    );
  } catch (e) {
    if (caller && jobId) {
      const reason = e instanceof HttpError ? e.message : 'internal';
      try {
        await caller.client
          .from('import_jobs')
          .update({ status: 'failed', error: reason })
          .eq('id', jobId);
      } catch { /* best-effort */ }
    }
    if (e instanceof HttpError) {
      log({
        request_id: requestId,
        profile_id: null,
        household_id: null,
        function: 'import-url',
        event: 'request.error',
        level: 'error',
        error: { name: e.name, message: e.message },
      });
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    const err = e as Error;
    log({
      request_id: requestId,
      profile_id: null,
      household_id: null,
      function: 'import-url',
      event: 'request.error',
      level: 'error',
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return jsonResponse({ error: 'internal', request_id: requestId }, 500, cors);
  }
});
