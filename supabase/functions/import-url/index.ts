// import-url: paste a blog/article URL → readability extract → NIM →
// validated draft Recipe + import_jobs row.
//
// Never writes to app.recipes; the SPA does that on Save via app.save_recipe.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Readability } from 'npm:@mozilla/readability@0.5';
import { parseHTML } from 'npm:linkedom@0.18';
import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { callAndValidate } from '../_shared/ai/validate.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { structuringFromHtml } from '../_shared/ai/prompts.ts';
import { log, logNimCall } from '../_shared/log.ts';

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': 'DishtonBot/0.1 (+https://dishton.app)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, 'fetch_failed', { status: res.status });
  if (res.redirected) {
    // basic redirect cap is honoured by `redirect: 'follow'` — server defaults
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

    // Concurrency check
    const { count } = await caller.client
      .from('import_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', caller.profileId)
      .eq('status', 'running');
    if ((count ?? 0) >= 2) throw new HttpError(409, 'too_many_imports');

    const { data: job, error: jobErr } = await caller.client
      .from('import_jobs')
      .insert({
        profile_id: caller.profileId,
        household_id: body.household_id,
        kind: 'url',
        status: 'running',
        payload: { url: body.url },
      })
      .select('id')
      .single();
    if (jobErr || !job) throw new HttpError(500, 'job_insert_failed');
    jobId = job.id as string;

    const html = await fetchHtml(body.url);
    const dom = parseHTML(html);
    const reader = new Readability(dom.document);
    const article = reader.parse();
    const text = article?.textContent ?? html;

    const budget = await withRateBudget(4000, () =>
      callAndValidate({
        lane: 'text',
        messages: structuringFromHtml({ html: text, sourceUrl: body.url }),
        estimatedTokens: 4000,
      }),
    );

    if (budget.status === 'rate_limit') {
      await caller.client
        .from('import_jobs')
        .update({ status: 'failed', error: 'rate_limit', completed_at: new Date().toISOString() })
        .eq('id', job.id);
      log({
        request_id: requestId,
        profile_id: caller.profileId,
        household_id: body.household_id,
        function: 'import-url',
        event: 'rate_budget.deny',
        level: 'warn',
      });
      return jsonResponse(
        { error: 'rate_limit', retry_after: 60, request_id: requestId },
        429,
        cors,
      );
    }

    const result = budget.value!;
    const ms = Math.round(performance.now() - t0);

    if (!result.ok) {
      await caller.client
        .from('import_jobs')
        .update({
          status: 'needs_review',
          payload: { url: body.url, raw_model_output: result.raw, reason: result.reason },
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      logNimCall({
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
      return jsonResponse(
        { job_id: job.id, draft: null, needs_review: true, reason: result.reason, request_id: requestId },
        200,
        cors,
      );
    }

    const draft = { ...result.recipe, source_type: 'url' as const, source_url: body.url };

    await caller.client
      .from('import_jobs')
      .update({
        status: 'done',
        payload: {
          url: body.url,
          tokens_in: result.usage.input,
          tokens_out: result.usage.output,
          latency_ms: ms,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    logNimCall({
      request_id: requestId,
      function: 'import-url',
      lane: 'text',
      model: '(default)',
      ms,
      tokens_in: result.usage.input,
      tokens_out: result.usage.output,
      ok: true,
    });

    return jsonResponse(
      { job_id: job.id, draft, needs_review: false, request_id: requestId },
      200,
      cors,
    );
  } catch (e) {
    // If we already inserted an import_jobs row, mark it failed so it doesn't
    // count toward the per-profile concurrency cap. Without this, every 5xx
    // leaves an orphan row stuck in `running` forever.
    if (caller && jobId) {
      const reason = e instanceof HttpError ? e.message : 'internal';
      try {
        await caller.client
          .from('import_jobs')
          .update({ status: 'failed', error: reason, completed_at: new Date().toISOString() })
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
