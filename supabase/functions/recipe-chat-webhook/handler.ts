import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../_shared/env.ts';
import { verifyWebhook } from '../_shared/agents/webhook.ts';
import { listEvents, sendToolResult } from '../_shared/agents/transport.ts';
import { getRecipe, listMyRecipes, validateDraft } from '../_shared/agents/recipe-tools.ts';

function admin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'app' },
  });
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  const secret = env.ANTHROPIC_WEBHOOK_SIGNING_KEY;
  if (!secret) return new Response('not configured', { status: 500 });

  const raw = await req.text();
  const ok = await verifyWebhook(secret, raw, {
    'webhook-id': req.headers.get('webhook-id') ?? undefined,
    'webhook-timestamp': req.headers.get('webhook-timestamp') ?? undefined,
    'webhook-signature': req.headers.get('webhook-signature') ?? undefined,
  });
  if (!ok) return new Response('invalid signature', { status: 400 });

  const event = JSON.parse(raw) as { data?: { type?: string; id?: string } };
  const type = event.data?.type;
  const anthropicSessionId = event.data?.id;
  if (!anthropicSessionId) return new Response(null, { status: 204 });

  const db = admin();
  const { data: session } = await db
    .from('recipe_chat_sessions')
    .select('id, household_id, anthropic_session_id, events_cursor, draft_repair_attempts')
    .eq('anthropic_session_id', anthropicSessionId)
    .single();
  if (!session) return new Response(null, { status: 204 }); // not ours

  if (type === 'session.status_run_started') {
    await db.from('recipe_chat_sessions').update({ status: 'running' }).eq('id', session.id);
    return new Response(null, { status: 204 });
  }
  if (type === 'session.status_terminated') {
    await db.from('recipe_chat_sessions').update({ status: 'error' }).eq('id', session.id);
    await db.from('recipe_chat_messages').insert({
      chat_session_id: session.id,
      role: 'agent',
      content: 'Something went wrong with this draft. Please start a new one.',
    });
    return new Response(null, { status: 204 });
  }
  if (type !== 'session.status_idled') return new Response(null, { status: 204 });

  // Drain new events past the cursor and resolve any pending tool calls.
  const events = await listEvents(anthropicSessionId);
  const cursor = session.events_cursor as string | null;
  const startIdx = cursor ? events.findIndex((e) => e.id === cursor) + 1 : 0;
  const fresh = events.slice(startIdx);
  let repairAttempts = session.draft_repair_attempts as number;
  let lastId = cursor;

  for (const ev of fresh) {
    lastId = ev.id;
    if (ev.type === 'agent.custom_tool_use') {
      try {
        if (ev.name === 'list_my_recipes') {
          const out = await listMyRecipes(db as never, session.household_id as string, ev.input ?? {});
          await sendToolResult(anthropicSessionId, ev.id, out);
        } else if (ev.name === 'get_recipe') {
          const out = await getRecipe(
            db as never,
            session.household_id as string,
            String((ev.input ?? {}).recipe_id ?? ''),
          );
          await sendToolResult(anthropicSessionId, ev.id, out);
        } else if (ev.name === 'present_draft') {
          const v = validateDraft(ev.input);
          if (v.ok) {
            await db
              .from('recipe_chat_sessions')
              .update({ current_draft: v.recipe, draft_repair_attempts: 0 })
              .eq('id', session.id);
            await sendToolResult(anthropicSessionId, ev.id, { ok: true });
          } else if (repairAttempts < 2) {
            repairAttempts += 1;
            await db
              .from('recipe_chat_sessions')
              .update({ draft_repair_attempts: repairAttempts })
              .eq('id', session.id);
            await sendToolResult(anthropicSessionId, ev.id, { ok: false, errors: v.errors }, true);
          } else {
            await sendToolResult(
              anthropicSessionId,
              ev.id,
              { ok: false, errors: ['too many invalid drafts'] },
              true,
            );
            await db.from('recipe_chat_messages').insert({
              chat_session_id: session.id,
              role: 'agent',
              content: "I couldn't produce a valid recipe. Could you adjust what you're after?",
            });
          }
        } else {
          await sendToolResult(anthropicSessionId, ev.id, { error: 'unknown tool' }, true);
        }
      } catch (_e) {
        await sendToolResult(anthropicSessionId, ev.id, { error: 'tool failed' }, true);
      }
    } else if (ev.type === 'agent.message') {
      const text = (ev.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      if (text.trim()) {
        await db.from('recipe_chat_messages').insert({
          chat_session_id: session.id,
          role: 'agent',
          content: text,
        });
      }
    }
  }

  await db
    .from('recipe_chat_sessions')
    .update({ status: 'idle', events_cursor: lastId })
    .eq('id', session.id);
  return new Response(null, { status: 204 });
};
