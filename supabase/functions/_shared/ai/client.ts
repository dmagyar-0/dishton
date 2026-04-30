// NIM client wrapper. Authenticates with NVIDIA, retries on 5xx and 429
// with backoff + jitter, never on other 4xx, surfaces typed errors.
//
// Edge-function only — never imported from the SPA bundle.

// @ts-expect-error — npm specifier resolved by Deno at runtime
import { OpenAI } from 'npm:openai@4';
import { env } from '../env.ts';

export type Lane = 'text' | 'vision';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const TIMEOUT_MS: Record<Lane, number> = { text: 30_000, vision: 60_000 };
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client === null) {
    _client = new OpenAI({ apiKey: env.NVIDIA_API_KEY, baseURL: BASE_URL });
  }
  return _client;
}

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

export async function nimChat(opts: NimCallOpts): Promise<NimResult> {
  const model =
    opts.model ?? (opts.lane === 'text' ? env.NIM_TEXT_MODEL : env.NIM_VISION_MODEL);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS[opts.lane]);
    try {
      const res = await client().chat.completions.create(
        {
          model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 4096,
          stream: false,
        },
        { signal: opts.signal ?? ac.signal },
      );
      clearTimeout(t);
      const content = res.choices[0]?.message?.content ?? '';
      return {
        content,
        usage: {
          input: res.usage?.prompt_tokens ?? 0,
          output: res.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      const status = (err as { status?: number }).status;
      // 4xx other than 429 are not retried
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt === MAX_RETRIES - 1) throw err;
      const jitter = Math.random() * 250;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]! + jitter));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('unreachable');
}
