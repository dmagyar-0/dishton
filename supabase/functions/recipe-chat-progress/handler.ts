import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { isMockMode } from '../_shared/ai/mock.ts';
import { listEvents } from '../_shared/agents/transport.ts';
import { currentPhase, storeAgentMessages } from '../_shared/agents/messages.ts';

const Body = z.object({ chat_session_id: z.string().uuid() });

// Polled by the SPA while the agent is working. The webhook only runs when the
// session idles, which for a draft is after the whole recipe JSON has been
// generated; this reads the session's events in between so the agent's
// opening sentence appears as soon as it's written, and reports a coarse phase
// for the thinking indicator. Read-only towards the agent: tool calls are
// still answered by the webhook alone.
export const handler = async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    // Caller-scoped read: RLS returns the row only to household members.
    const { data: session, error } = await caller.client
      .from('recipe_chat_sessions')
      .select('id, anthropic_session_id, status')
      .eq('id', body.chat_session_id)
      .single();
    if (error || !session) throw new HttpError(404, 'session_not_found');
    if (isMockMode() || session.status !== 'running') {
      return jsonResponse({ phase: 'thinking' }, 200, cors);
    }

    const events = await listEvents(session.anthropic_session_id as string);
    // Caller-scoped write, so RLS (editor-only insert) governs it exactly as
    // for the SPA; a viewer's poll just leaves storage to the webhook.
    await storeAgentMessages(caller.client, session.id as string, events);
    return jsonResponse({ phase: currentPhase(events) }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    return jsonResponse({ error: 'internal' }, 500, cors);
  }
};
