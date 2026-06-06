import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { env } from '../_shared/env.ts';
import { isMockMode } from '../_shared/ai/mock.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { createSession, sendUserMessage } from '../_shared/agents/transport.ts';

const Body = z.object({
  chat_session_id: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  household_id: z.string().uuid(),
});

export const handler = async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    // Reserve AI budget per turn (mirrors the import functions).
    const budget = await withRateBudget(caller.profileId, 4000, async () => true);
    if (budget.status === 'rate_limit') {
      return jsonResponse({ error: 'rate_limit', retry_after: 60 }, 429, cors);
    }

    let chatSessionId = body.chat_session_id;
    if (!chatSessionId) {
      const agentId = env.RECIPE_AGENT_ID ?? '';
      const environmentId = env.RECIPE_ENV_ID ?? '';
      if (!isMockMode() && (!agentId || !environmentId)) {
        throw new HttpError(500, 'recipe_agent_not_configured');
      }
      const session = await createSession({
        agentId,
        environmentId,
        title: body.message.slice(0, 80),
      });
      const { data, error } = await caller.client
        .from('recipe_chat_sessions')
        .insert({
          household_id: body.household_id,
          created_by: caller.profileId,
          anthropic_session_id: session.id,
          status: 'running',
        })
        .select('id, anthropic_session_id')
        .single();
      if (error || !data) throw new HttpError(403, 'cannot_create_session');
      chatSessionId = data.id as string;
      await sendUserMessage(data.anthropic_session_id as string, body.message);
    } else {
      const { data, error } = await caller.client
        .from('recipe_chat_sessions')
        .select('anthropic_session_id')
        .eq('id', chatSessionId)
        .single();
      if (error || !data) throw new HttpError(404, 'session_not_found');
      await sendUserMessage(data.anthropic_session_id as string, body.message);
    }

    await caller.client.from('recipe_chat_messages').insert({
      chat_session_id: chatSessionId,
      role: 'user',
      content: body.message,
    });

    return jsonResponse({ chat_session_id: chatSessionId }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    return jsonResponse({ error: 'internal' }, 500, cors);
  }
};
