// Mirrors agent.message events into app.recipe_chat_messages. Shared by the
// webhook (runs when the session idles) and recipe-chat-progress (polled while
// the agent is still running). Keyed on the event id, so the two paths never
// double-insert the same reply.

import type { AppClient } from '../auth.ts';
import type { AgentEvent } from './transport.ts';

export function agentMessageText(ev: AgentEvent): string {
  return (ev.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

export async function storeAgentMessages(
  db: AppClient,
  chatSessionId: string,
  events: AgentEvent[],
): Promise<void> {
  const rows = events
    .filter((ev) => ev.type === 'agent.message')
    .map((ev) => ({ ev, text: agentMessageText(ev) }))
    .filter(({ text }) => text.trim().length > 0)
    .map(({ ev, text }) => ({
      chat_session_id: chatSessionId,
      role: 'agent',
      content: text,
      anthropic_event_id: ev.id,
    }));
  if (rows.length === 0) return;
  const { error } = await db
    .from('recipe_chat_messages')
    .upsert(rows, { onConflict: 'anthropic_event_id', ignoreDuplicates: true });
  // Best effort, like the webhook's other chat inserts: a failed mirror must
  // not fail the caller (the webhook would be redelivered after it already
  // answered tool calls). The other path retries the same event id later.
  if (error) console.error('storeAgentMessages failed', error.message);
}

export type ChatPhase = 'thinking' | 'searching' | 'drafting';

// What the agent is doing in the current turn, read from the events after the
// latest user.message. Coarse on purpose: the list only holds completed
// events, so the in-flight model request is inferred from what preceded it.
export function currentPhase(events: AgentEvent[]): ChatPhase {
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'user.message') {
      start = i + 1;
      break;
    }
  }
  let phase: ChatPhase = 'thinking';
  for (const ev of events.slice(start)) {
    if (ev.type === 'agent.tool_use' && ev.name === 'web_search') phase = 'searching';
    else if (ev.type === 'agent.tool_result') phase = 'thinking';
    // The agent says what it is making, then writes the full recipe as
    // present_draft input: after a reply, the slow part is that draft.
    else if (ev.type === 'agent.message') phase = 'drafting';
    else if (ev.type === 'agent.custom_tool_use') phase = 'thinking';
  }
  return phase;
}
