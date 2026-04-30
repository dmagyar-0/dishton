// import-instagram: oEmbed → caption + thumbnail → NIM → draft Recipe.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from '../_shared/domain/recipe.ts';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { callAndValidate } from '../_shared/ai/validate.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { structuringFromCaption } from '../_shared/ai/prompts.ts';
import { env } from '../_shared/env.ts';
import { log, logNimCall } from '../_shared/log.ts';

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

type OEmbed = {
  title?: string;
  html?: string;
  thumbnail_url?: string;
  author_name?: string;
};

async function fetchOEmbed(url: string, token: string): Promise<OEmbed | null> {
  const endpoint =
    `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return (await res.json()) as OEmbed;
}

async function fetchOgFallback(url: string): Promise<OEmbed | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'DishtonBot/0.1 (+https://dishton.app)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const og = (key: string): string | undefined => {
    const m = new RegExp(`<meta[^>]+property=["']og:${key}["'][^>]+content=["']([^"']+)`, 'i').exec(
      html,
    );
    return m?.[1];
  };
  const title = og('title');
  const description = og('description');
  const image = og('image');
  if (!description && !title) return null;
  return {
    title: title ?? '',
    html: description ?? '',
    thumbnail_url: image,
  };
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const requestId = crypto.randomUUID();
  const t0 = performance.now();
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    log({
      request_id: requestId,
      profile_id: caller.profileId,
      household_id: body.household_id,
      function: 'import-instagram',
      event: 'request.start',
    });

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

    let oembed: OEmbed | null = null;
    if (env.IG_OEMBED_TOKEN) {
      oembed = await fetchOEmbed(body.url, env.IG_OEMBED_TOKEN);
    }
    if (!oembed) oembed = await fetchOgFallback(body.url);
    if (!oembed) {
      await caller.client
        .from('import_jobs')
        .update({
          status: 'failed',
          error: 'instagram_unavailable',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      throw new HttpError(422, 'instagram_unavailable');
    }

    const caption = `${oembed.title ?? ''}\n\n${(oembed.html ?? '').replace(/<[^>]+>/g, '')}`;

    const budget = await withRateBudget(1200, () =>
      callAndValidate({
        lane: 'text',
        messages: structuringFromCaption({ caption, sourceUrl: body.url }),
        estimatedTokens: 1200,
      }),
    );

    const ms = Math.round(performance.now() - t0);

    if (budget.status === 'rate_limit') {
      await caller.client
        .from('import_jobs')
        .update({ status: 'failed', error: 'rate_limit', completed_at: new Date().toISOString() })
        .eq('id', job.id);
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

    logNimCall({
      request_id: requestId,
      function: 'import-instagram',
      lane: 'text',
      model: '(default)',
      ms,
      tokens_in: result.usage.input,
      tokens_out: result.usage.output,
      ok: true,
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
      function: 'import-instagram',
      event: 'request.error',
      level: 'error',
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return jsonResponse({ error: 'internal', request_id: requestId }, 500, cors);
  }
});
