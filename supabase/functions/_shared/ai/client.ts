// NIM client wrapper. Authenticates with NVIDIA, retries on 5xx and 429
// with backoff + jitter, never on other 4xx, surfaces typed errors.
//
// Edge-function only — never imported from the SPA bundle.

import { env } from '../env.ts';

export type Lane = 'text' | 'vision';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const TIMEOUT_MS: Record<Lane, number> = { text: 90_000, vision: 90_000 };
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

export type NimMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

export type NimCallOpts = {
  lane: Lane;
  model?: string;
  messages: NimMessage[];
  estimatedTokens: number;
  signal?: AbortSignal;
  temperature?: number;
};

export type NimResult = {
  content: string;
  usage: { input: number; output: number };
};

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

class NimHttpError extends Error {
  constructor(public status: number, body: string) {
    super(`NIM ${status}: ${body.slice(0, 200)}`);
  }
}

export async function nimChat(opts: NimCallOpts): Promise<NimResult> {
  const model =
    opts.model ?? (opts.lane === 'text' ? env.NIM_TEXT_MODEL : env.NIM_VISION_MODEL);

  const body = JSON.stringify({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    stream: false,
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS[opts.lane]);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'authorization': `Bearer ${env.NVIDIA_API_KEY}`,
          'content-type': 'application/json',
          'accept': 'application/json',
        },
        body,
      });
      clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      if (!res.ok) {
        const text = await res.text();
        const err = new NimHttpError(res.status, text);
        // 4xx other than 429 are not retried
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
        if (attempt === MAX_RETRIES - 1) throw err;
        const jitter = Math.random() * 250;
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]! + jitter));
        continue;
      }
      const data = (await res.json()) as ChatCompletionResponse;
      return {
        content: data.choices[0]?.message?.content ?? '',
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      lastErr = err;
      if (err instanceof NimHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (attempt === MAX_RETRIES - 1) throw err;
      const jitter = Math.random() * 250;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]! + jitter));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('unreachable');
}
