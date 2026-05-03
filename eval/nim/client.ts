// Minimal NIM client for the eval harness. No retries (production retries
// hide reliability differences between models, which we want to surface).
// Accepts fetchImpl injection for testing.

import type { NimMessage } from '../../supabase/functions/_shared/ai/client.ts';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NimError extends Error {
  constructor(
    public kind: 'http' | 'timeout' | 'network',
    public status?: number,
    public body?: string,
  ) {
    super(`nim ${kind}${status !== undefined ? ` ${status}` : ''}`);
  }
}

export type CallResult = {
  raw: string;
  usage: { input: number; output: number };
  latencyMs: number;
};

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function callNim(opts: {
  apiKey: string;
  model: string;
  messages: NimMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CallResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const start = performance.now();
  try {
    const res = await fetchFn(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'authorization': `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.1,
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NimError('http', res.status, body.slice(0, 500));
    }
    const data = (await res.json()) as ChatCompletionResponse;
    return {
      raw: data.choices[0]?.message?.content ?? '',
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  } catch (err) {
    if (err instanceof NimError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NimError('timeout');
    }
    throw new NimError('network', undefined, String((err as Error).message ?? err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
