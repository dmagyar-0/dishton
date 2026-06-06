import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { archiveSession } from '../_shared/agents/transport.ts';

const Body = z.object({ chat_session_id: z.string().uuid() });

export const handler = async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    const { data: session, error } = await caller.client
      .from('recipe_chat_sessions')
      .select('id, household_id, anthropic_session_id, current_draft, recipe_id')
      .eq('id', body.chat_session_id)
      .single();
    if (error || !session) throw new HttpError(404, 'session_not_found');
    if (!session.current_draft) throw new HttpError(409, 'no_draft');
    if (session.recipe_id) {
      return jsonResponse({ recipe_id: session.recipe_id }, 200, cors); // idempotent
    }

    const { data: recipeId, error: saveErr } = await caller.client.rpc('save_recipe', {
      p_household: session.household_id,
      p_draft: session.current_draft as never,
    });
    if (saveErr) throw new HttpError(400, 'save_failed');

    await caller.client
      .from('recipe_chat_sessions')
      .update({ status: 'saved', recipe_id: recipeId })
      .eq('id', session.id);
    try {
      await archiveSession(session.anthropic_session_id as string);
    } catch {
      /* best-effort */
    }

    return jsonResponse({ recipe_id: recipeId }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    return jsonResponse({ error: 'internal' }, 500, cors);
  }
};
