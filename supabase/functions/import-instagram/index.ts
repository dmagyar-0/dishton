// import-instagram: keyless caption fetch → caption + thumbnail → Anthropic →
// draft Recipe + import_jobs row.
//
// The caption comes from the post's public /embed/captioned/ page, parsed out
// of the rendered Caption div (see fallback.ts). No API keys are used. The
// embed page is used because Instagram now walls the post page itself from
// datacenter IPs (the Edge Function's egress), while the embed surface — built
// for third-party server-side rendering — still returns the caption.
//
// See import-url for the sync-vs-background lifecycle. The Realtime listener
// only acts on `awaiting_save`, so a sync import never races with the
// listener.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { z } from "zod";
import {
  assertHouseholdMember,
  corsHeaders,
  getCallerPreferredLanguage,
  getHouseholdAllowedTags,
  HttpError,
  jsonResponse,
  resolveCaller,
} from "../_shared/auth.ts";
import { callValidateThenTranslate } from "../_shared/ai/validate.ts";
import { refundBudgets, withRateBudget } from "../_shared/ai/rate-budget.ts";
import { rehostRemoteHeroImage } from "../_shared/scrape/rehost-image.ts";
import { structuringFromCaption } from "../_shared/ai/prompts.ts";
import { runDetached } from "../_shared/import-runner.ts";
import { log, logAiCall } from "../_shared/log.ts";
import { fetchInstagramCaption, type FetchEvent } from "./fallback.ts";

const Body = z.object({
  url: z.string().url(),
  household_id: z.string().uuid(),
});

const CONCURRENCY_CAP = 5;
const RAW_PREVIEW_LIMIT = 240;

type CaptionSource = "embed";

type AiUsage = {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
};

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
    reason:
      | "parse"
      | "schema"
      | "empty"
      | "rate_limit"
      | "upstream"
      | "instagram_unavailable";
    raw: string | null;
    captionSource: CaptionSource | null;
    captionLength: number;
    latencyMs: number;
  };

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const requestId = crypto.randomUUID();
  const t0 = performance.now();
  let caller: Awaited<ReturnType<typeof resolveCaller>> | null = null;
  let jobId: string | null = null;
  let householdId: string | null = null;

  const emit = (
    event: string,
    extra: Record<string, unknown> = {},
    level: "debug" | "info" | "warn" | "error" = "info",
  ): void => {
    log({
      request_id: requestId,
      profile_id: caller?.profileId ?? null,
      household_id: householdId,
      function: "import-instagram",
      event,
      level,
      ...extra,
    });
  };

  try {
    caller = await resolveCaller(req);
    const body = Body.parse(await req.json());
    householdId = body.household_id;

    emit("request.start", { url_host: safeHost(body.url) });

    await caller.client.rpc("reap_stuck_imports");

    // The job row and the saved recipe are scoped to this household; reject
    // a household the caller doesn't belong to before doing any work.
    await assertHouseholdMember(
      caller.client,
      caller.profileId,
      body.household_id,
    );

    const { count } = await caller.client
      .from("import_jobs")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", caller.profileId)
      .in("status", ["queued", "running", "awaiting_save"]);
    if ((count ?? 0) >= CONCURRENCY_CAP) {
      throw new HttpError(409, "too_many_imports");
    }

    const { data: job, error: jobErr } = await caller.client
      .from("import_jobs")
      .insert({
        profile_id: caller.profileId,
        household_id: body.household_id,
        kind: "instagram",
        status: "running",
        phase: "scrape",
        payload: { url: body.url },
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new HttpError(500, "job_insert_failed");
    jobId = job.id as string;

    const targetLanguage = await getCallerPreferredLanguage(
      caller.client,
      caller.profileId,
    );
    const allowedTags = await getHouseholdAllowedTags(
      caller.client,
      body.household_id,
    );

    const callerClient = caller.client;
    const callerProfileId = caller.profileId;
    const fetchEvents: FetchEvent[] = [];

    const work = async (): Promise<WorkResult> => {
      const fetchLogger = (e: FetchEvent): void => {
        fetchEvents.push(e);
        emit(
          "caption.fetch",
          {
            fetch_url: e.url,
            ok: e.ok,
            status: e.status ?? null,
            ms: e.ms,
            reason: e.reason ?? null,
          },
          e.ok ? "info" : "warn",
        );
      };

      const oe = await fetchInstagramCaption(body.url, undefined, fetchLogger);

      const latencyMs = Math.round(performance.now() - t0);

      if (!oe) {
        emit(
          "request.unavailable",
          {
            ms: latencyMs,
            attempts: fetchEvents.map((e) => ({
              ok: e.ok,
              status: e.status ?? null,
              reason: e.reason ?? null,
            })),
          },
          "warn",
        );
        return {
          ok: false,
          reason: "instagram_unavailable",
          raw: null,
          captionSource: null,
          captionLength: 0,
          latencyMs,
        };
      }

      // Past the guard the caption came from the embed page.
      const captionSource: CaptionSource = "embed";

      const caption = oe.author ? `@${oe.author}\n\n${oe.caption}` : oe.caption;
      const captionLength = caption.length;
      const hasThumbnail = Boolean(oe.thumbnailUrl);
      emit("caption.ready", {
        source: captionSource,
        caption_length: captionLength,
        has_author: Boolean(oe.author),
        has_thumbnail: hasThumbnail,
      });

      await callerClient
        .from("import_jobs")
        .update({ phase: "ai", progress_text: "Asking the model" })
        .eq("id", jobId);

      const budget = await withRateBudget(
        callerProfileId,
        1200,
        () =>
          callValidateThenTranslate(
            {
              lane: "text",
              messages: structuringFromCaption({
                caption,
                sourceUrl: body.url,
                allowedTags,
              }),
              estimatedTokens: 1200,
            },
            targetLanguage,
          ),
      );

      const ms = Math.round(performance.now() - t0);

      if (budget.status === "rate_limit") {
        emit(
          "request.rate_limit",
          { ms, caption_source: captionSource },
          "warn",
        );
        return {
          ok: false,
          reason: "rate_limit",
          raw: null,
          captionSource,
          captionLength,
          latencyMs: ms,
        };
      }

      const result = budget.value!;
      if (!result.ok) {
        // `upstream` means the model call itself failed — nothing was spent,
        // so hand the reservation back. parse/schema failures consumed real
        // tokens and stay charged.
        if (result.reason === "upstream") {
          await refundBudgets(callerProfileId, 1200);
        }
        emit(
          "request.needs_review",
          {
            ms,
            reason: result.reason,
            caption_source: captionSource,
            caption_length: captionLength,
            has_thumbnail: hasThumbnail,
            raw_length: result.raw.length,
            raw_preview: result.raw.slice(0, RAW_PREVIEW_LIMIT),
          },
          "warn",
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
        function: "import-instagram",
        lane: "text",
        model: result.model,
        ms,
        tokens_in: result.usage.input,
        tokens_out: result.usage.output,
        cache_read: result.usage.cache_read,
        cache_write: result.usage.cache_write,
        ok: true,
      });
      emit("request.success", {
        ms,
        caption_source: captionSource,
        caption_length: captionLength,
        ai_model: result.model,
        ai_tokens_in: result.usage.input,
        ai_tokens_out: result.usage.output,
      });

      // The model's hero_image_path came out of an untrusted caption. Re-host
      // it into our own bucket (SSRF-guarded) so household members' browsers
      // never load an attacker-chosen URL.
      const heroImagePath = await rehostRemoteHeroImage(
        callerClient,
        callerProfileId,
        result.recipe.hero_image_path,
      );

      return {
        ok: true,
        draft: {
          ...result.recipe,
          hero_image_path: heroImagePath,
          source_type: "instagram" as const,
          source_url: body.url,
        },
        thumbnailUrl: oe.thumbnailUrl ?? null,
        usage: result.usage,
        model: result.model,
        captionSource,
        captionLength,
        latencyMs: ms,
      };
    };

    const onFinish = async (value: WorkResult): Promise<void> => {
      if (!value.ok) {
        if (value.reason === "rate_limit" || value.reason === "upstream") {
          await callerClient
            .from("import_jobs")
            .update({
              status: "failed",
              error: value.reason,
              payload: { url: body.url, latency_ms: value.latencyMs },
            })
            .eq("id", jobId);
          return;
        }
        if (
          value.reason === "instagram_unavailable" || value.reason === "empty"
        ) {
          // 'empty' = the model returned a schema-valid but content-less draft
          // (no ingredients and no steps), which happens when the caption has
          // no recipe in it. Fail with a clear "no recipe found" message rather
          // than saving a blank recipe.
          await callerClient
            .from("import_jobs")
            .update({
              status: "failed",
              error: value.reason,
              payload: { url: body.url, latency_ms: value.latencyMs },
            })
            .eq("id", jobId);
          return;
        }
        await callerClient
          .from("import_jobs")
          .update({
            status: "needs_review",
            payload: {
              url: body.url,
              raw_model_output: value.raw,
              reason: value.reason,
              latency_ms: value.latencyMs,
            },
          })
          .eq("id", jobId);
        return;
      }
      await callerClient
        .from("import_jobs")
        .update({
          status: "awaiting_save",
          phase: "saving",
          progress_text: "Saving recipe",
          payload: {
            url: body.url,
            draft: value.draft,
            thumbnail_url: value.thumbnailUrl,
            tokens_in: value.usage.input,
            tokens_out: value.usage.output,
            latency_ms: value.latencyMs,
          },
        })
        .eq("id", jobId);
    };

    const onError = async (err: unknown): Promise<void> => {
      const reason = err instanceof HttpError ? err.message : "internal";
      await callerClient
        .from("import_jobs")
        .update({ status: "failed", error: reason })
        .eq("id", jobId);
    };

    runDetached<WorkResult>({ work, onFinish, onError });
    emit("background.detach");
    return jsonResponse(
      { job_id: jobId, status: "running", request_id: requestId },
      202,
      cors,
    );
  } catch (e) {
    if (caller && jobId) {
      const reason = e instanceof HttpError ? e.message : "internal";
      try {
        await caller.client
          .from("import_jobs")
          .update({ status: "failed", error: reason })
          .eq("id", jobId);
      } catch { /* best-effort */ }
    }
    if (e instanceof HttpError) {
      emit(
        "request.http_error",
        {
          status: e.status,
          code: e.code,
          ms: Math.round(performance.now() - t0),
        },
        e.status >= 500 ? "error" : "warn",
      );
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    const err = e as Error;
    emit(
      "request.error",
      {
        ms: Math.round(performance.now() - t0),
        error: { name: err.name, message: err.message, stack: err.stack },
      },
      "error",
    );
    return jsonResponse(
      { error: "internal", request_id: requestId },
      500,
      cors,
    );
  }
});

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
