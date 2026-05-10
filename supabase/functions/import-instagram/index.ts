// import-instagram: oEmbed → caption + thumbnail → Anthropic → draft Recipe.

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
import { withTimeout } from '../_shared/timeout.ts';
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

const INLINE_BUDGET_MS = 30_000;
const RAW_PREVIEW_LIMIT = 240;

type CaptionSource = 'oembed' | FallbackTier;

type OEmbedAttempt =
  | { ok: true; body: OEmbed; status: number; ms: number }
  | { ok: false; status?: number; ms: number; reason: 'fetch_error' | 'non_ok' | 'parse_error' };

function mergeSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  return parent
    ? AbortSignal.any([parent, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}

async function fetchOEmbed(
  url: string,
  token: string,
  parent?: AbortSignal,
): Promise<OEmbedAttempt> {
  const endpoint =
    `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint, { signal: mergeSignal(parent, 10_000) });
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

    // See import-url for the rationale: reap any running rows whose worker
    // was hard-killed before we count slots, so a wedged user recovers.
    await caller.client.rpc('reap_stuck_imports');

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
        kind: 'instagram',
        status: 'running',
        payload: { url: body.url },
      })
      .select('id')
      .single();
    if (jobErr || !job) throw new HttpError(500, 'job_insert_failed');
    jobId = job.id as string;

    const targetLanguage = await getCallerPreferredLanguage(caller.client, caller.profileId);
    const allowedTags = await getHouseholdAllowedTags(caller.client, body.household_id);

    const fallbackEvents: FallbackEvent[] = [];
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

    const {
      oembed,
      budget,
      captionSource,
      captionLength,
      hasThumbnail,
      oembedAttempt,
    } = await withTimeout(INLINE_BUDGET_MS, req.signal, async (signal) => {
      let oe: OEmbed | null = null;
      let source: CaptionSource | null = null;
      let oeAttempt: OEmbedAttempt | null = null;

      if (env.IG_OEMBED_TOKEN) {
        oeAttempt = await fetchOEmbed(body.url, env.IG_OEMBED_TOKEN, signal);
        emit(
          'oembed.attempt',
          {
            ok: oeAttempt.ok,
            status: oeAttempt.ok ? oeAttempt.status : oeAttempt.status ?? null,
            ms: oeAttempt.ms,
            reason: oeAttempt.ok ? null : oeAttempt.reason,
          },
          oeAttempt.ok ? 'info' : 'warn',
        );
        if (oeAttempt.ok) {
          oe = oeAttempt.body;
          source = 'oembed';
        }
      } else {
        emit('oembed.attempt', { ok: false, reason: 'no_token', skipped: true }, 'info');
      }

      if (!oe) {
        const fb = await fetchOgFallback(body.url, signal, fallbackLogger, env.SCRAPER_API_KEY);
        if (fb) {
          oe = fb.oembed;
          source = fb.source;
        }
      }

      if (!oe) {
        return {
          oembed: null,
          budget: null,
          captionSource: null,
          captionLength: 0,
          hasThumbnail: false,
          oembedAttempt: oeAttempt,
        };
      }

      const caption = `${oe.title ?? ''}\n\n${(oe.html ?? '').replace(/<[^>]+>/g, '')}`;
      emit('caption.ready', {
        source,
        caption_length: caption.length,
        has_title: Boolean(oe.title),
        has_thumbnail: Boolean(oe.thumbnail_url),
      });

      const b = await withRateBudget(1200, () =>
        callAndValidate({
          lane: 'text',
          messages: structuringFromCaption({
            caption,
            sourceUrl: body.url,
            targetLanguage,
            allowedTags,
          }),
          estimatedTokens: 1200,
          signal,
        }),
      );
      return {
        oembed: oe,
        budget: b,
        captionSource: source,
        captionLength: caption.length,
        hasThumbnail: Boolean(oe.thumbnail_url),
        oembedAttempt: oeAttempt,
      };
    });

    if (!oembed || !budget) {
      const ms = Math.round(performance.now() - t0);
      await caller.client
        .from('import_jobs')
        .update({
          status: 'failed',
          error: 'instagram_unavailable',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      emit(
        'request.unavailable',
        {
          ms,
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
      throw new HttpError(422, 'instagram_unavailable');
    }

    const ms = Math.round(performance.now() - t0);

    if (budget.status === 'rate_limit') {
      await caller.client
        .from('import_jobs')
        .update({ status: 'failed', error: 'rate_limit', completed_at: new Date().toISOString() })
        .eq('id', job.id);
      emit('request.rate_limit', { ms, caption_source: captionSource }, 'warn');
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
          payload: { url: body.url, raw_model_output: result.raw, reason: result.reason },
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
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
      return jsonResponse(
        { job_id: job.id, draft: null, needs_review: true, reason: result.reason, request_id: requestId },
        200,
        cors,
      );
    }

    const draft = {
      ...result.recipe,
      source_type: 'instagram' as const,
      source_url: body.url,
    };

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

    return jsonResponse(
      {
        job_id: job.id,
        draft,
        needs_review: false,
        thumbnail_url: oembed.thumbnail_url ?? null,
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
          .update({ status: 'failed', error: reason, completed_at: new Date().toISOString() })
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
