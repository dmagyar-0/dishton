// import-photo: read uploaded images from the `imports` bucket via short-
// lived signed URLs → Anthropic vision → draft Recipe + import_jobs row.
//
// See import-url for the sync-vs-background lifecycle. The Realtime listener
// only acts on `awaiting_save`, so a sync import never races with the
// listener.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from 'zod';
import {
  type AppClient,
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
import { isOwnedStoragePath } from '../_shared/storage-path.ts';
import { log, logAiCall } from '../_shared/log.ts';

const FIRST_RESPONSE_MS = 10_000;
const CONCURRENCY_CAP = 5;
const MAX_PHOTOS = 6;
const TOKENS_BASE = 2000;
const TOKENS_PER_PHOTO = 1500;

const Body = z.object({
  household_id: z.string().uuid(),
  paths: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS),
  comment: z.string().trim().max(500).optional(),
});

// Server-side caps on the uploaded object. The SPA enforces these too, but
// client checks are bypassable (a caller can POST arbitrary paths). We HEAD the
// storage object and reject anything oversized or not an image before signing.
const MAX_OBJECT_BYTES = 12 * 1024 * 1024; // headroom over the client's 10 MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Confirm the storage object exists and is an image within the size cap.
// storage.list() on the object's parent folder, filtered to the filename,
// returns the object's metadata (size + mimetype). Throws HttpError on any
// problem so the caller's existing try/catch records the job as failed.
async function assertValidImageObject(client: AppClient, path: string): Promise<void> {
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await client.storage
    .from('imports')
    .list(folder, { limit: 1, search: name });
  if (error) throw new HttpError(404, 'object_not_found');
  const obj = data?.find((o) => o.name === name);
  if (!obj) throw new HttpError(404, 'object_not_found');
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = typeof meta.size === 'number' ? meta.size : 0;
  if (size > MAX_OBJECT_BYTES) throw new HttpError(413, 'photo_too_large');
  const mime = (meta.mimetype ?? '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mime)) throw new HttpError(415, 'not_image');
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

    // Every path must live under the caller's own uid prefix. The signing
    // client uses the service role and bypasses storage RLS, so without this
    // check a caller could sign (and exfiltrate via the vision model) any
    // other user's uploaded photo. Reject before doing any storage work.
    for (const path of body.paths) {
      if (!isOwnedStoragePath(path, caller.profileId)) {
        throw new HttpError(403, 'forbidden_path');
      }
    }

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

    const signedUrls: string[] = [];
    for (const path of body.paths) {
      // Validate the object server-side before signing: confirm it exists and
      // is an image within the size cap (client checks are bypassable). list()
      // on the parent folder returns metadata (size, mimetype) for the object.
      await assertValidImageObject(caller.client, path);
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
    const callerProfileId = caller.profileId;

    const work = async (): Promise<WorkResult> => {
      await callerClient
        .from('import_jobs')
        .update({ phase: 'ai', progress_text: 'Asking the model' })
        .eq('id', jobId);

      const budget = await withRateBudget(callerProfileId, estimatedTokens, () =>
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

      const latencyMs = Math.round(performance.now() - t0);

      if (budget.status === 'rate_limit') {
        return { ok: false, reason: 'rate_limit', raw: null, latencyMs };
      }

      const result = budget.value!;
      if (!result.ok) {
        return { ok: false, reason: result.reason, raw: result.raw, latencyMs };
      }

      logAiCall({
        request_id: requestId,
        function: 'import-photo',
        lane: 'vision',
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
        draft: { ...result.recipe, source_type: 'photo' as const, source_url: null },
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
              payload: {
                paths: body.paths,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
                latency_ms: value.latencyMs,
              },
            })
            .eq('id', jobId);
          return;
        }
        await callerClient
          .from('import_jobs')
          .update({
            status: 'needs_review',
            payload: {
              paths: body.paths,
              ...(trimmedComment ? { comment: trimmedComment } : {}),
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
            paths: body.paths,
            ...(trimmedComment ? { comment: trimmedComment } : {}),
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
        function: 'import-photo',
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
