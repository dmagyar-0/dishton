// Raw-HTTP client for the Anthropic Managed Agents REST API. We deliberately
// avoid @anthropic-ai/sdk here: the version pinned for the import functions
// (^0.40.0) predates Managed Agents and lacks the beta.sessions/agents/webhooks
// namespaces. Mock mode mirrors _shared/ai/mock.ts so local dev, tests, and
// Playwright run the full flow without an Anthropic key.

import { env } from '../env.ts';
import { isMockMode } from '../ai/mock.ts';

const BASE = 'https://api.anthropic.com';
const BETA = 'managed-agents-2026-04-01';

function headers(): HeadersInit {
  return {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA,
    'content-type': 'application/json',
  };
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`managed-agents ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export type Session = { id: string; status: string };

export type AgentEvent = {
  id: string;
  type: string;
  // present on agent.custom_tool_use:
  name?: string;
  input?: Record<string, unknown>;
  // present on agent.message:
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type: string } | null;
};

export async function createSession(opts: {
  agentId: string;
  environmentId: string;
  title?: string;
}): Promise<Session> {
  if (isMockMode()) return { id: `sesn_mock_${crypto.randomUUID()}`, status: 'running' };
  return (await call('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      agent: opts.agentId,
      environment_id: opts.environmentId,
      title: opts.title,
    }),
  })) as Session;
}

export async function sendUserMessage(sessionId: string, text: string): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
    }),
  });
}

export async function sendToolResult(
  sessionId: string,
  toolUseId: string,
  result: unknown,
  isError = false,
): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [
        {
          type: 'user.custom_tool_result',
          custom_tool_use_id: toolUseId,
          content: [{ type: 'text', text: JSON.stringify(result) }],
          is_error: isError,
        },
      ],
    }),
  });
}

export async function listEvents(sessionId: string): Promise<AgentEvent[]> {
  if (isMockMode()) return [];
  const data = (await call(`/v1/sessions/${sessionId}/events?limit=1000`, {
    method: 'GET',
  })) as { data: AgentEvent[] };
  return data.data ?? [];
}

export async function archiveSession(sessionId: string): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/archive`, { method: 'POST', body: '{}' });
}
