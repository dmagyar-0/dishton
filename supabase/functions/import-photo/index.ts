// import-photo: read an uploaded image from the `imports` bucket via a
// short-lived signed URL → Anthropic vision → draft Recipe.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { callAndValidate } from '../_shared/ai/validate.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { structuringFromImage } from '../_shared/ai/prompts.ts';
import { withTimeout } from '../_shared/timeout.ts';
import { log, logAiCall } from '../_shared/log.ts';

const INLINE_BUDGET_MS = 30_000;

const Body = z.object({
  job_id: z.string().uuid().optional(),
  household_id: z.string().uuid(),
  path: z.string().min(1),
  comment: z.string().trim().max(500).optional(),
});

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
      function: 'import-photo',
      event: 'request.start',
    });

    // See import-url for the rationale: reap any running rows whose worker
    // was hard-killed before we count slots, so a wedged user recovers.
    await caller.client.rpc('reap_stuck_imports');

    const { count } = await caller.client
      .from('import_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', caller.profileId)
      .eq('status', 'running');
    if ((count ?? 0) >= 2) throw new HttpError(409, 'too_many_imports');

    const trimmedComment = body.comment?.trim() || undefined;

    jobId = body.job_id ?? null;
    if (!jobId) {
      const { data: job, error: jobErr } = await caller.client
        .from('import_jobs')
        .insert({
          profile_id: caller.profileId,
          household_id: body.household_id,
          kind: 'photo',
          status: 'running',
          payload: trimmedComment
            ? { path: body.path, comment: trimmedComment }
            : { path: body.path },
        })
        .select('id')
        .single();
      if (jobErr || !job) throw new HttpError(500, 'job_insert_failed');
      jobId = job.id as string;
    }

    const { data: signed, error: signErr } = await caller.client.storage
      .from('imports')
      .createSignedUrl(body.path, 300);
    if (signErr || !signed?.signedUrl) throw new HttpError(404, 'object_not_found');
    const signedUrl = signed.signedUrl;

    const budget = await withTimeout(INLINE_BUDGET_MS, req.signal, async (signal) =>
      await withRateBudget(3500, () =>
        callAndValidate({
          lane: 'vision',
          messages: structuringFromImage({ imageUrl: signedUrl, comment: trimmedComment }),
          estimatedTokens: 3500,
          signal,
        }),
      ),
    );

    const ms = Math.round(performance.now() - t0);

    if (budget.status === 'rate_limit') {
      await caller.client
        .from('import_jobs')
        .update({ status: 'failed', error: 'rate_limit', completed_at: new Date().toISOString() })
        .eq('id', jobId);
      return jsonResponse(
        { error: 'rate_limit', retry_after: 60, request_id: requestId },
        429,
        cors,
      );
    }

    const result = budget.value!;
    if (!result.ok) {
      await caller.client
        .from('import_jobs')
        .update({
          status: 'needs_review',
          payload: {
            path: body.path,
            ...(trimmedComment ? { comment: trimmedComment } : {}),
            raw_model_output: result.raw,
            reason: result.reason,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return jsonResponse(
        { job_id: jobId, draft: null, needs_review: true, reason: result.reason, request_id: requestId },
        200,
        cors,
      );
    }

    const draft = { ...result.recipe, source_type: 'photo' as const, source_url: null };

    await caller.client
      .from('import_jobs')
      .update({
        status: 'done',
        payload: {
          path: body.path,
          ...(trimmedComment ? { comment: trimmedComment } : {}),
          tokens_in: result.usage.input,
          tokens_out: result.usage.output,
          latency_ms: ms,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    logAiCall({
      request_id: requestId,
      function: 'import-photo',
      lane: 'vision',
      model: result.model,
      ms,
      tokens_in: result.usage.input,
      tokens_out: result.usage.output,
      cache_read: result.usage.cache_read,
      cache_write: result.usage.cache_write,
      ok: true,
    });

    return jsonResponse(
      { job_id: jobId, draft, needs_review: false, request_id: requestId },
      200,
      cors,
    );
  } catch (e) {
    if (caller && jobId) {
      const reason = e instanceof HttpError ? e.message : 'internal';
      try {
        await caller.client
          .from('import_jobs')
          .update({ status: 'failed', error: reason, completed_at: new Date().toISOString() })
          .eq('id', jobId);
      } catch { /* best-effort */ }
    }
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    const err = e as Error;
    log({
      request_id: requestId,
      profile_id: null,
      household_id: null,
      function: 'import-photo',
      event: 'request.error',
      level: 'error',
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return jsonResponse({ error: 'internal', request_id: requestId }, 500, cors);
  }
});
