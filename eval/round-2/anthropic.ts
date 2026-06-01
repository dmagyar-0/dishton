// Round-2 Anthropic adapter. Unlike the legacy eval/nim/anthropic.ts (text-mode
// JSON, no tools, always sends temperature), this matches production: forced
// `extract_recipe` tool use + prompt caching, with optional adaptive thinking
// and effort. Raw HTTP (no SDK) so the exact request body is auditable.
//
// Key correctness notes:
// - Opus 4.x rejects `temperature`/`top_p`/`top_k` and `budget_tokens` (HTTP
//   400). Adaptive thinking also disallows sampling params. So temperature is
//   only sent for non-Opus, non-thinking calls where the caller set it.
// - Forcing a specific tool (`tool_choice:{type:"tool"}`) is incompatible with
//   thinking on, so the orchestrator passes `{type:"auto"}` for thinking
//   configs. Either way we read the first matching tool_use block.

import type { AiMessage } from '../../supabase/functions/_shared/ai/client.ts';

const BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export class AnthropicError extends Error {
  constructor(
    public kind: 'http' | 'timeout' | 'network',
    public status?: number,
    public body?: string,
  ) {
    super(`anthropic ${kind}${status !== undefined ? ` ${status}` : ''}`);
  }
}

export type AnthropicUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AnthropicCallResult = {
  raw: string; // tool_use input as JSON (preferred) or concatenated text
  usedTool: boolean;
  usage: AnthropicUsage;
  latencyMs: number;
  stopReason: string | null;
};

type ResponseBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
};

type MessageResponse = {
  content?: ResponseBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function splitSystem(
  messages: AiMessage[],
): { system: unknown[] | undefined; rest: unknown[] } {
  const systemTexts: string[] = [];
  const rest: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemTexts.push(m.content);
      else for (const b of m.content) if (b.type === 'text') systemTexts.push(b.text);
      continue;
    }
    rest.push({ role: m.role, content: m.content });
  }
  if (systemTexts.length === 0) return { system: undefined, rest };
  return {
    system: [{
      type: 'text',
      text: systemTexts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    }],
    rest,
  };
}

export async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  maxTokens?: number;
  timeoutMs: number;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: Record<string, unknown>;
  thinking?: 'adaptive';
  effort?: Effort;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AnthropicCallResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const start = performance.now();

  const { system, rest } = splitSystem(opts.messages);

  const isOpus = opts.model.startsWith('claude-opus');
  const sendTemp = opts.temperature !== undefined && !isOpus && !opts.thinking;

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? (opts.thinking ? 16_000 : 8_192),
    messages: rest,
    ...(system ? { system } : {}),
    ...(sendTemp ? { temperature: opts.temperature } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    ...(opts.thinking ? { thinking: { type: opts.thinking } } : {}),
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
  };

  try {
    const res = await fetchFn(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'x-api-key': opts.apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AnthropicError('http', res.status, text.slice(0, 800));
    }
    const data = (await res.json()) as MessageResponse;
    const blocks = data.content ?? [];

    const forcedName = opts.toolChoice?.type === 'tool'
      ? (opts.toolChoice.name as string | undefined)
      : undefined;

    let raw = '';
    let usedTool = false;
    for (const b of blocks) {
      if (b.type === 'tool_use' && (!forcedName || b.name === forcedName)) {
        raw = JSON.stringify(b.input ?? null);
        usedTool = true;
        break;
      }
    }
    if (!usedTool) {
      raw = blocks.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('');
    }

    return {
      raw,
      usedTool,
      usage: {
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
        cacheRead: data.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
      },
      latencyMs,
      stopReason: data.stop_reason ?? null,
    };
  } catch (err) {
    if (err instanceof AnthropicError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AnthropicError('timeout');
    }
    throw new AnthropicError('network', undefined, String((err as Error).message ?? err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
