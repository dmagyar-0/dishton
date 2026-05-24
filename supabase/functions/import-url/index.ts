// import-url: paste a blog/article URL → JSON-LD scrape + lightStripHtml →
// Anthropic → validated draft Recipe + import_jobs row.
//
// The edge function never writes to app.recipes; the SPA does that on save
// (whether triggered by the synchronous response or by the active-imports
// Realtime listener picking up an `awaiting_save` row).
//
// Lifecycle: every run inserts an import_jobs row at status='running' and
// — if the AI work outlives the 10 s first-response window — keeps going
// via EdgeRuntime.waitUntil. On success the worker flips the row to
// `awaiting_save` with payload.draft populated, so the SPA's Realtime
// subscription delivers the draft regardless of whether the original HTTP
// response was awaited.

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
import { lightStripHtml } from '../_shared/scrape/strip-html.ts';
import { runWithBackgroundDetach } from '../_shared/import-runner.ts';
import { log, logAiCall } from '../_shared/log.ts';

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;
const FIRST_RESPONSE_MS = 10_000;
const TOTAL_BUDGET_MS = 120_000;
const CONCURRENCY_CAP = 5;

async function fetchHtml(url: string): Promise<string> {
  const signal = AbortSignal.timeout(15_000);
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': 'DishtonBot/0.1 (+https://dishton.app)' },
    signal,
  });
  if (!res.ok) throw new HttpError(502, 'fetch_failed', { status: res.status });
  if (res.redirected) {
    void MAX_REDIRECTS;
  }
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
  return new TextDecoder('utf-8').decode(concat(chunks));
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

type RunOk = {
  ok: true;
  draft: Record<string, unknown>;
  needs_review: false;
};
type RunNeedsReview = {
  ok: false;
  reason: 'parse' | 'schema' | 'rate_limit' | 'upstream';
  needs_review: true;
};
type RunResult = RunOk | RunNeedsReview;

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

    // Reap rows whose worker was hard-killed (no DB heartbeat exists, so a
    // crashed run leaves status='running' until something flips it). Run
    // this BEFORE the cap check so a wedged user (5/5 stuck) self-recovers
    // on their next attempt.
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

    // The worker writes terminal state to import_jobs itself — both branches
    // of runWithBackgroundDetach observe the same lifecycle via Realtime.
    const callerClient = caller.client;
    const callerProfileId = caller.profileId;
    const callerHouseholdId = body.household_id;
    const runImport = async (): Promise<RunResult> => {
      try {
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

        const budget = await withRateBudget(4000, () =>
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
        const ms = Math.round(performance.now() - t0);

        if (budget.status === 'rate_limit') {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'failed',
              error: 'rate_limit',
              payload: { url: body.url, latency_ms: ms },
            })
            .eq('id', jobId);
          log({
            request_id: requestId,
            profile_id: callerProfileId,
            household_id: callerHouseholdId,
            function: 'import-url',
            event: 'rate_budget.deny',
            level: 'warn',
          });
          return { ok: false, needs_review: true, reason: 'rate_limit' };
        }

        const result = budget.value!;
        if (!result.ok) {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'needs_review',
              payload: {
                url: body.url,
                raw_model_output: result.raw,
                reason: result.reason,
                latency_ms: ms,
              },
            })
            .eq('id', jobId);
          logAiCall({
            request_id: requestId,
            function: 'import-url',
            lane: 'text',
            model: '(unknown)',
            ms,
            tokens_in: 0,
            tokens_out: 0,
            ok: false,
            reason: result.reason,
          });
          return { ok: false, needs_review: true, reason: result.reason };
        }

        const draft = {
          ...result.recipe,
          source_type: 'url' as const,
          source_url: body.url,
        };

        await callerClient
          .from('import_jobs')
          .update({
            status: 'awaiting_save',
            phase: 'saving',
            progress_text: 'Saving recipe',
            payload: {
              url: body.url,
              draft,
              tokens_in: result.usage.input,
              tokens_out: result.usage.output,
              latency_ms: ms,
            },
          })
          .eq('id', jobId);

        logAiCall({
          request_id: requestId,
          function: 'import-url',
          lane: 'text',
          model: result.model,
          ms,
          tokens_in: result.usage.input,
          tokens_out: result.usage.output,
          cache_read: result.usage.cache_read,
          cache_write: result.usage.cache_write,
          ok: true,
        });

        return { ok: true, draft, needs_review: false };
      } catch (err) {
        const reason = err instanceof HttpError ? err.message : 'internal';
        await callerClient
          .from('import_jobs')
          .update({ status: 'failed', error: reason })
          .eq('id', jobId);
        throw err;
      }
    };

    const detach = await runWithBackgroundDetach<RunResult>({
      totalMs: TOTAL_BUDGET_MS,
      firstResponseMs: FIRST_RESPONSE_MS,
      run: runImport,
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

    const result = detach.value;
    if (!result.ok) {
      return jsonResponse(
        {
          job_id: jobId,
          draft: null,
          needs_review: true,
          reason: result.reason,
          request_id: requestId,
        },
        200,
        cors,
      );
    }

    return jsonResponse(
      { job_id: jobId, draft: result.draft, needs_review: false, request_id: requestId },
      200,
      cors,
    );
  } catch (e) {
    // Worker writes its own terminal state, but if the failure happened
    // before we entered runImport (auth, body parse, job insert) we still
    // need to mark any partial row failed.
    if (caller && jobId) {
      const reason = e instanceof HttpError ? e.message : 'internal';
      try {
        await caller.client
          .from('import_jobs')
          .update({ status: 'failed', error: reason })
          .eq('id', jobId);
      } catch { /* best-effort; outer error is what we report */ }
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
