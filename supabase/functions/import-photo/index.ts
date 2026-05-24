// import-photo: read uploaded images from the `imports` bucket via short-
// lived signed URLs → Anthropic vision → draft Recipe + import_jobs row.
//
// Lifecycle: see import-url for the runWithBackgroundDetach contract. Vision
// inference is the slowest of the three lanes — long photo imports detach
// after 10 s; the worker keeps going via EdgeRuntime.waitUntil and writes
// `awaiting_save` (or terminal) to the import_jobs row.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
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
import { structuringFromImage } from '../_shared/ai/prompts.ts';
import { runWithBackgroundDetach } from '../_shared/import-runner.ts';
import { log, logAiCall } from '../_shared/log.ts';

const FIRST_RESPONSE_MS = 10_000;
const TOTAL_BUDGET_MS = 120_000;
const CONCURRENCY_CAP = 5;
const MAX_PHOTOS = 6;
// Vision input scales ~1500 tokens per image at Haiku 4.5; 2000 covers prompt
// + output. Single-photo budget stays at 3500 to preserve existing behaviour.
const TOKENS_BASE = 2000;
const TOKENS_PER_PHOTO = 1500;

const Body = z.object({
  job_id: z.string().uuid().optional(),
  household_id: z.string().uuid(),
  paths: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS),
  comment: z.string().trim().max(500).optional(),
});

type RunOk = {
  ok: true;
  draft: Record<string, unknown>;
  needs_review: false;
};
type RunFail = {
  ok: false;
  needs_review: true;
  reason: 'parse' | 'schema' | 'rate_limit' | 'upstream';
  http_status: 200 | 429;
};
type RunResult = RunOk | RunFail;

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

    await caller.client.rpc('reap_stuck_imports');

    const { count } = await caller.client
      .from('import_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', caller.profileId)
      .in('status', ['queued', 'running', 'awaiting_save']);
    if ((count ?? 0) >= CONCURRENCY_CAP) throw new HttpError(409, 'too_many_imports');

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
          phase: 'scrape',
          payload: trimmedComment
            ? { paths: body.paths, comment: trimmedComment }
            : { paths: body.paths },
        })
        .select('id')
        .single();
      if (jobErr || !job) throw new HttpError(500, 'job_insert_failed');
      jobId = job.id as string;
    }

    const signedUrls: string[] = [];
    for (const path of body.paths) {
      const { data: signed, error: signErr } = await caller.client.storage
        .from('imports')
        .createSignedUrl(path, 300);
      if (signErr || !signed?.signedUrl) throw new HttpError(404, 'object_not_found');
      signedUrls.push(signed.signedUrl);
    }

    const targetLanguage = await getCallerPreferredLanguage(caller.client, caller.profileId);
    const allowedTags = await getHouseholdAllowedTags(caller.client, body.household_id);

    const estimatedTokens = TOKENS_BASE + TOKENS_PER_PHOTO * body.paths.length;
    const callerClient = caller.client;

    const runImport = async (): Promise<RunResult> => {
      try {
        await callerClient
          .from('import_jobs')
          .update({ phase: 'ai', progress_text: 'Asking the model' })
          .eq('id', jobId);

        const budget = await withRateBudget(estimatedTokens, () =>
          callAndValidate({
            lane: 'vision',
            messages: structuringFromImage({
              imageUrls: signedUrls,
              comment: trimmedComment,
              targetLanguage,
              allowedTags,
            }),
            estimatedTokens,
          }),
        );

        const ms = Math.round(performance.now() - t0);

        if (budget.status === 'rate_limit') {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'failed',
              error: 'rate_limit',
              payload: {
                paths: body.paths,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
                latency_ms: ms,
              },
            })
            .eq('id', jobId);
          return {
            ok: false,
            needs_review: true,
            reason: 'rate_limit',
            http_status: 429,
          };
        }

        const result = budget.value!;
        if (!result.ok) {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'needs_review',
              payload: {
                paths: body.paths,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
                raw_model_output: result.raw,
                reason: result.reason,
                latency_ms: ms,
              },
            })
            .eq('id', jobId);
          return {
            ok: false,
            needs_review: true,
            reason: result.reason,
            http_status: 200,
          };
        }

        const draft = {
          ...result.recipe,
          source_type: 'photo' as const,
          source_url: null,
        };

        await callerClient
          .from('import_jobs')
          .update({
            status: 'awaiting_save',
            phase: 'saving',
            progress_text: 'Saving recipe',
            payload: {
              paths: body.paths,
              ...(trimmedComment ? { comment: trimmedComment } : {}),
              draft,
              tokens_in: result.usage.input,
              tokens_out: result.usage.output,
              latency_ms: ms,
            },
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
        function: 'import-photo',
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
      if (result.http_status === 429) {
        return jsonResponse(
          { error: 'rate_limit', retry_after: 60, request_id: requestId },
          429,
          cors,
        );
      }
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
