// Anthropic adapter for the NIM eval harness — lets us include Claude models
// (e.g. claude-haiku-4-5) as candidates alongside NVIDIA NIM models.
//
// Mirrors client.ts's surface (`callAnthropic` returns the same {raw, usage,
// latencyMs} shape) so run.ts can dispatch to either backend by the
// candidate's `provider` field.

import type { NimMessage } from '../../supabase/functions/_shared/ai/client.ts';

const BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export class AnthropicError extends Error {
  constructor(
    public kind: 'http' | 'timeout' | 'network',
    public status?: number,
    public body?: string,
  ) {
    super(`anthropic ${kind}${status !== undefined ? ` ${status}` : ''}`);
  }
}

export type AnthropicCallResult = {
  raw: string;
  usage: { input: number; output: number };
  latencyMs: number;
};

type AnthropicMessageResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  messages: NimMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AnthropicCallResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const start = performance.now();

  // Anthropic puts `system` at the top level, not as a role. Extract any
  // system messages from the input, concatenate, and pass the rest through.
  const systemParts: string[] = [];
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of opts.messages) {
    if (typeof m.content !== 'string') {
      // Multimodal content (image_url) would need block conversion. The
      // eval harness scope is text-only (structuringFromHtml), so reject.
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      throw new AnthropicError('http', 400, 'multimodal content not supported by anthropic adapter');
    }
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.1,
    messages,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join('\n\n');
  }

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
      throw new AnthropicError('http', res.status, text.slice(0, 500));
    }
    const data = (await res.json()) as AnthropicMessageResponse;
    const raw = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('');
    return {
      raw,
      usage: {
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
      },
      latencyMs,
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
