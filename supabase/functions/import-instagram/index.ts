// import-instagram: oEmbed (or no-key fallback chain) → caption + thumbnail
// → Anthropic → draft Recipe + import_jobs row.
//
// See import-url for the sync-vs-background lifecycle. The Realtime listener
// only acts on `awaiting_save`, so a sync import never races with the
// listener.

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
import { structuringFromCaption } from '../_shared/ai/prompts.ts';
import { runWithBackgroundDetach } from '../_shared/import-runner.ts';
import { env } from '../_shared/env.ts';
import { log, logAiCall } from '../_shared/log.ts';
import {
  type FallbackEvent,
  type FallbackTier,
  fetchOgFallback,
  type OEmbed,
} from './fallback.ts';

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

const FIRST_RESPONSE_MS = 10_000;
const CONCURRENCY_CAP = 5;
const RAW_PREVIEW_LIMIT = 240;

type CaptionSource = 'oembed' | FallbackTier;

type OEmbedAttempt =
  | { ok: true; body: OEmbed; status: number; ms: number }
  | { ok: false; status?: number; ms: number; reason: 'fetch_error' | 'non_ok' | 'parse_error' };

async function fetchOEmbed(url: string, token: string): Promise<OEmbedAttempt> {
  const endpoint =
    `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, ms: Math.round(performance.now() - t0), reason: 'fetch_error' };
  }
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) return { ok: false, status: res.status, ms, reason: 'non_ok' };
  try {
    const body = (await res.json()) as OEmbed;
    return { ok: true, body, status: res.status, ms };
  } catch {
    return { ok: false, status: res.status, ms, reason: 'parse_error' };
  }
}

type AiUsage = { input: number; output: number; cache_read?: number; cache_write?: number };

type WorkResult =
  | {
      ok: true;
      draft: Record<string, unknown>;
      thumbnailUrl: string | null;
      usage: AiUsage;
      model: string;
      captionSource: CaptionSource;
      captionLength: number;
      latencyMs: number;
    }
  | {
      ok: false;
      reason: 'parse' | 'schema' | 'rate_limit' | 'upstream' | 'instagram_unavailable';
      raw: string | null;
      captionSource: CaptionSource | null;
      captionLength: number;
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
  let householdId: string | null = null;

  const emit = (
    event: string,
    extra: Record<string, unknown> = {},
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
  ): void => {
    log({
      request_id: requestId,
      profile_id: caller?.profileId ?? null,
      household_id: householdId,
      function: 'import-instagram',
      event,
      level,
      ...extra,
    });
  };

  try {
    caller = await resolveCaller(req);
    const body = Body.parse(await req.json());
    householdId = body.household_id;

    emit('request.start', { url_host: safeHost(body.url) });

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
        kind: 'instagram',
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
    const fallbackEvents: FallbackEvent[] = [];

    const work = async (): Promise<WorkResult> => {
      const fallbackLogger = (e: FallbackEvent): void => {
        fallbackEvents.push(e);
        emit(
          'oembed.fallback_tier',
          {
            tier: e.tier,
            tier_url: e.url,
            ok: e.ok,
            status: e.status ?? null,
            ms: e.ms,
            reason: e.reason ?? null,
          },
          e.ok ? 'info' : 'warn',
        );
      };

      let oe: OEmbed | null = null;
      let captionSource: CaptionSource | null = null;
      let oembedAttempt: OEmbedAttempt | null = null;

      if (env.IG_OEMBED_TOKEN) {
        oembedAttempt = await fetchOEmbed(body.url, env.IG_OEMBED_TOKEN);
        emit(
          'oembed.attempt',
          {
            ok: oembedAttempt.ok,
            status: oembedAttempt.ok ? oembedAttempt.status : oembedAttempt.status ?? null,
            ms: oembedAttempt.ms,
            reason: oembedAttempt.ok ? null : oembedAttempt.reason,
          },
          oembedAttempt.ok ? 'info' : 'warn',
        );
        if (oembedAttempt.ok) {
          oe = oembedAttempt.body;
          captionSource = 'oembed';
        }
      } else {
        emit('oembed.attempt', { ok: false, reason: 'no_token', skipped: true }, 'info');
      }

      if (!oe) {
        const fb = await fetchOgFallback(body.url, undefined, fallbackLogger, env.SCRAPER_API_KEY);
        if (fb) {
          oe = fb.oembed;
          captionSource = fb.source;
        }
      }

      const latencyMs = Math.round(performance.now() - t0);

      if (!oe) {
        emit(
          'request.unavailable',
          {
            ms: latencyMs,
            oembed_token_present: Boolean(env.IG_OEMBED_TOKEN),
            scraper_key_present: Boolean(env.SCRAPER_API_KEY),
            oembed_attempt: oembedAttempt
              ? {
                  ok: oembedAttempt.ok,
                  status: oembedAttempt.ok ? oembedAttempt.status : oembedAttempt.status ?? null,
                  reason: oembedAttempt.ok ? null : oembedAttempt.reason,
                }
              : null,
            fallback_tiers_tried: fallbackEvents.length,
            fallback_tiers: fallbackEvents.map((e) => ({
              tier: e.tier,
              ok: e.ok,
              status: e.status ?? null,
              reason: e.reason ?? null,
            })),
          },
          'warn',
        );
        return {
          ok: false,
          reason: 'instagram_unavailable',
          raw: null,
          captionSource: null,
          captionLength: 0,
          latencyMs,
        };
      }

      const caption = `${oe.title ?? ''}\n\n${(oe.html ?? '').replace(/<[^>]+>/g, '')}`;
      const captionLength = caption.length;
      const hasThumbnail = Boolean(oe.thumbnail_url);
      emit('caption.ready', {
        source: captionSource,
        caption_length: captionLength,
        has_title: Boolean(oe.title),
        has_thumbnail: hasThumbnail,
      });

      await callerClient
        .from('import_jobs')
        .update({ phase: 'ai', progress_text: 'Asking the model' })
        .eq('id', jobId);

      const budget = await withRateBudget(callerProfileId, 1200, () =>
        callAndValidate({
          lane: 'text',
          messages: structuringFromCaption({
            caption,
            sourceUrl: body.url,
            targetLanguage,
            allowedTags,
          }),
          estimatedTokens: 1200,
        }),
      );

      const ms = Math.round(performance.now() - t0);

      if (budget.status === 'rate_limit') {
        emit('request.rate_limit', { ms, caption_source: captionSource }, 'warn');
        return {
          ok: false,
          reason: 'rate_limit',
          raw: null,
          captionSource,
          captionLength,
          latencyMs: ms,
        };
      }

      const result = budget.value!;
      if (!result.ok) {
        emit(
          'request.needs_review',
          {
            ms,
            reason: result.reason,
            caption_source: captionSource,
            caption_length: captionLength,
            has_thumbnail: hasThumbnail,
            raw_length: result.raw.length,
            raw_preview: result.raw.slice(0, RAW_PREVIEW_LIMIT),
          },
          'warn',
        );
        return {
          ok: false,
          reason: result.reason,
          raw: result.raw,
          captionSource,
          captionLength,
          latencyMs: ms,
        };
      }

      logAiCall({
        request_id: requestId,
        function: 'import-instagram',
        lane: 'text',
        model: result.model,
        ms,
        tokens_in: result.usage.input,
        tokens_out: result.usage.output,
        cache_read: result.usage.cache_read,
        cache_write: result.usage.cache_write,
        ok: true,
      });
      emit('request.success', {
        ms,
        caption_source: captionSource,
        caption_length: captionLength,
        ai_model: result.model,
        ai_tokens_in: result.usage.input,
        ai_tokens_out: result.usage.output,
      });

      return {
        ok: true,
        draft: { ...result.recipe, source_type: 'instagram' as const, source_url: body.url },
        thumbnailUrl: oe.thumbnail_url ?? null,
        usage: result.usage,
        model: result.model,
        captionSource,
        captionLength,
        latencyMs: ms,
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
        if (value.reason === 'instagram_unavailable') {
          await callerClient
            .from('import_jobs')
            .update({
              status: 'failed',
              error: 'instagram_unavailable',
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
            thumbnail_url: value.thumbnailUrl,
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
      emit('background.detach');
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
      if (value.reason === 'instagram_unavailable') {
        throw new HttpError(422, 'instagram_unavailable');
      }
      if (value.reason === 'upstream') {
        return jsonResponse({ error: 'upstream', request_id: requestId }, 503, cors);
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
      {
        job_id: jobId,
        draft: value.draft,
        needs_review: false,
        thumbnail_url: value.thumbnailUrl,
        request_id: requestId,
      },
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
      emit(
        'request.http_error',
        { status: e.status, code: e.code, ms: Math.round(performance.now() - t0) },
        e.status >= 500 ? 'error' : 'warn',
      );
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    const err = e as Error;
    emit(
      'request.error',
      {
        ms: Math.round(performance.now() - t0),
        error: { name: err.name, message: err.message, stack: err.stack },
      },
      'error',
    );
    return jsonResponse({ error: 'internal', request_id: requestId }, 500, cors);
  }
});

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
