// translate-recipe: cache lookup; on miss, call NIM with the translation
// prompt, validate, upsert recipe_translations, return the payload.

// @ts-expect-error — Deno std import
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from '../_shared/domain/recipe.ts';
import { Recipe } from '../_shared/domain/recipe.ts';
import { buildTranslationCacheKey } from '../_shared/domain/translation-key.ts';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { callAndValidate } from '../_shared/ai/validate.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { translatePrompt } from '../_shared/ai/prompts.ts';
import { log, logNimCall } from '../_shared/log.ts';

const Body = z.object({
  recipe_id: z.string().uuid(),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
});

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
      household_id: null,
      function: 'translate-recipe',
      event: 'request.start',
    });

    // 1. read recipe + children via RLS-aware client
    const recipeRow = await caller.client.from('recipes').select('*').eq('id', body.recipe_id).single();
    if (recipeRow.error || !recipeRow.data) throw new HttpError(404, 'recipe_not_found');

    const ingredients = await caller.client
      .from('recipe_ingredients')
      .select('*')
      .eq('recipe_id', body.recipe_id)
      .order('position');
    const steps = await caller.client
      .from('recipe_steps')
      .select('*')
      .eq('recipe_id', body.recipe_id)
      .order('position');
    const tags = await caller.client.from('recipe_tags').select('tag').eq('recipe_id', body.recipe_id);

    const recipe = Recipe.parse({
      title: recipeRow.data.title,
      description: recipeRow.data.description,
      source_type: recipeRow.data.source_type,
      source_url: recipeRow.data.source_url,
      source_language: recipeRow.data.source_language,
      canonical_unit_system: recipeRow.data.canonical_unit_system,
      servings: recipeRow.data.servings,
      total_time_min: recipeRow.data.total_time_min,
      hero_image_path: recipeRow.data.hero_image_path,
      tags: (tags.data ?? []).map((t: { tag: string }) => t.tag),
      ingredients: (ingredients.data ?? []).map((i: Record<string, unknown>) => ({
        position: i.position,
        raw_text: i.raw_text,
        quantity: i.quantity,
        unit: i.unit,
        ingredient_name: i.ingredient_name,
        notes: i.notes,
        scalable: true,
        non_scalable_qty: null,
      })),
      steps: (steps.data ?? []).map((s: Record<string, unknown>) => ({
        position: s.position,
        body: s.body,
        duration_min: s.duration_min,
      })),
    });

    if (body.language === recipe.source_language) {
      return jsonResponse({ payload: recipe, cached: false, request_id: requestId }, 200, cors);
    }

    const { sourceHash } = buildTranslationCacheKey(recipe, body.language);

    // 2. cache hit?
    const cache = await caller.client
      .from('recipe_translations')
      .select('payload, source_hash')
      .eq('recipe_id', body.recipe_id)
      .eq('language', body.language)
      .maybeSingle();
    if (cache.data && cache.data.source_hash === sourceHash) {
      return jsonResponse(
        { payload: cache.data.payload, cached: true, request_id: requestId },
        200,
        cors,
      );
    }

    // 3. miss → NIM
    const budget = await withRateBudget(2500, () =>
      callAndValidate({
        lane: 'text',
        messages: translatePrompt({ recipeJson: JSON.stringify(recipe), targetLanguage: body.language }),
        estimatedTokens: 2500,
        temperature: 0.2,
      }),
    );

    const ms = Math.round(performance.now() - t0);

    if (budget.status === 'rate_limit') {
      return jsonResponse(
        { error: 'rate_limit', retry_after: 60, request_id: requestId },
        429,
        cors,
      );
    }
    const result = budget.value!;
    if (!result.ok) {
      return jsonResponse(
        { error: 'translation_failed', reason: result.reason, request_id: requestId },
        502,
        cors,
      );
    }

    // 4. upsert via service role (RLS write requires it)
    await caller.client
      .from('recipe_translations')
      .upsert({
        recipe_id: body.recipe_id,
        language: body.language,
        payload: result.recipe,
        source_hash: sourceHash,
      });

    logNimCall({
      request_id: requestId,
      function: 'translate-recipe',
      lane: 'text',
      model: '(default)',
      ms,
      tokens_in: result.usage.input,
      tokens_out: result.usage.output,
      ok: true,
    });

    return jsonResponse(
      { payload: result.recipe, cached: false, request_id: requestId },
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
      function: 'translate-recipe',
      event: 'request.error',
      level: 'error',
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return jsonResponse({ error: 'internal', request_id: requestId }, 500, cors);
  }
});
