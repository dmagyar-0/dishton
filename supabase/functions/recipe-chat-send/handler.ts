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

// In AI_MOCK_MODE the real agent + webhook round-trip is skipped, so this
// canned draft stands in for what present_draft would store — letting local
// dev, Playwright, and visual validation exercise the full UI without an
// Anthropic key. Never used when mock mode is off.
const MOCK_DRAFT = {
  title: 'Cozy Roasted Squash Soup',
  description: 'A velvety autumn soup with warm spices and a little maple sweetness.',
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 45,
  hero_image_path: null,
  tags: ['soup', 'autumn', 'vegetarian'],
  ingredients: [
    {
      position: 0,
      raw_text: '1 kg butternut squash, peeled and cubed',
      quantity: 1,
      unit: 'kg',
      ingredient_name: 'butternut squash',
      notes: 'peeled and cubed',
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
    {
      position: 1,
      raw_text: '1 onion, diced',
      quantity: 1,
      unit: null,
      ingredient_name: 'onion',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
    {
      position: 2,
      raw_text: '750 ml vegetable stock',
      quantity: 750,
      unit: 'ml',
      ingredient_name: 'vegetable stock',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
    {
      position: 3,
      raw_text: 'Salt and pepper to taste',
      quantity: null,
      unit: null,
      ingredient_name: 'salt and pepper',
      notes: null,
      scalable: true,
      non_scalable_qty: 'to_taste',
      section: null,
    },
  ],
  steps: [
    { position: 0, body: 'Roast the squash at 200°C for 25 minutes until tender.', duration_min: 25 },
    { position: 1, body: 'Sauté the onion until soft and golden.', duration_min: 6 },
    {
      position: 2,
      body: 'Combine squash, onion, and stock; blend until smooth and season to taste.',
      duration_min: 10,
    },
  ],
};

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

    // Mock mode: synthesize the agent's reply + draft inline (no live agent or
    // webhook). Writes go through the caller's editor-scoped client, so RLS
    // still governs them exactly as the real flow's service-role writes would.
    if (isMockMode()) {
      await caller.client
        .from('recipe_chat_sessions')
        .update({ current_draft: MOCK_DRAFT, status: 'idle' })
        .eq('id', chatSessionId);
      await caller.client.from('recipe_chat_messages').insert({
        chat_session_id: chatSessionId,
        role: 'agent',
        content:
          "Here's a draft based on your vibe — a cozy roasted squash soup. Tell me what to tweak, or save it to your pantry when you're happy.",
      });
    }

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
