import { assertEquals } from 'jsr:@std/assert';
import { agentMessageText, currentPhase } from './messages.ts';
import type { AgentEvent } from './transport.ts';

const ev = (type: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({
  id: `e_${Math.random()}`,
  type,
  ...extra,
});

Deno.test('currentPhase is thinking before the agent has done anything', () => {
  assertEquals(currentPhase([ev('user.message'), ev('session.status_running')]), 'thinking');
});

Deno.test('currentPhase reports a web search in flight', () => {
  assertEquals(
    currentPhase([ev('user.message'), ev('agent.tool_use', { name: 'web_search' })]),
    'searching',
  );
});

Deno.test('currentPhase reports drafting once the opening reply is written', () => {
  assertEquals(
    currentPhase([
      ev('user.message'),
      ev('agent.tool_use', { name: 'web_search' }),
      ev('agent.tool_result'),
      ev('agent.message', { content: [{ type: 'text', text: 'A squash soup.' }] }),
    ]),
    'drafting',
  );
});

Deno.test('currentPhase stays on drafting across a tool call before the draft', () => {
  assertEquals(
    currentPhase([
      ev('user.message'),
      ev('agent.message', { content: [{ type: 'text', text: 'A lemon pasta.' }] }),
      ev('agent.custom_tool_use', { name: 'get_recipe' }),
      ev('user.custom_tool_result'),
    ]),
    'drafting',
  );
});

Deno.test('currentPhase goes back to thinking once the draft is presented', () => {
  assertEquals(
    currentPhase([
      ev('user.message'),
      ev('agent.message', { content: [{ type: 'text', text: 'A lemon pasta.' }] }),
      ev('agent.custom_tool_use', { name: 'present_draft' }),
    ]),
    'thinking',
  );
});

Deno.test('currentPhase only looks at the latest turn', () => {
  assertEquals(
    currentPhase([
      ev('user.message'),
      ev('agent.message', { content: [{ type: 'text', text: 'Old reply' }] }),
      ev('agent.custom_tool_use', { name: 'present_draft' }),
      ev('user.message'),
    ]),
    'thinking',
  );
});

Deno.test('agentMessageText joins only the text blocks', () => {
  assertEquals(
    agentMessageText(
      ev('agent.message', {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'image' },
          { type: 'text', text: 'there' },
        ],
      }),
    ),
    'Hello there',
  );
});
