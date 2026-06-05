// Anthropic client wrapper. Authenticates with the Anthropic SDK, retries on
// 5xx and 429 with backoff + jitter, never on other 4xx, surfaces typed
// errors. Per-lane default model: Haiku 4.5 for text, Sonnet 4.6 for vision
// (eval round 2 found Haiku unreliable on multi-column cookbook-table photos).
//
// Edge-function only — never imported from the SPA bundle.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import { env } from '../env.ts';
import { isMockMode, mockAiChat } from './mock.ts';

export type Lane = 'text' | 'vision';

// Per-lane default model. Vision defaults to Sonnet 4.6: eval round 2
// (eval/round-2/README.md) found Haiku 4.5 fails multi-column cookbook-table
// photos (wrong dish, mixed columns, hallucinations) while Sonnet 4.6 extracts
// them cleanly for ~$0.07/photo. Adaptive thinking did not help and is not used.
// Override per lane via ANTHROPIC_MODEL (text) / ANTHROPIC_MODEL_VISION (vision).
const DEFAULT_MODEL: Record<Lane, string> = {
  text: 'claude-haiku-4-5',
  vision: 'claude-sonnet-4-6',
};

function laneModel(lane: Lane): string {
  const override = lane === 'vision' ? env.ANTHROPIC_MODEL_VISION : env.ANTHROPIC_MODEL;
  return override ?? DEFAULT_MODEL[lane];
}

const MAX_OUTPUT_TOKENS = 4096;

const TIMEOUT_MS: Record<Lane, number> = { text: 90_000, vision: 90_000 };
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'url'; url: string } | {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      } }
    >;
};

export type AiCallOpts = {
  lane: Lane;
  model?: string;
  messages: AiMessage[];
  estimatedTokens: number;
  signal?: AbortSignal;
  temperature?: number;
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
};

export type AiResult = {
  content: string;
  // When `tools` is set and the model invoked one, this holds the parsed
  // `input` field of the first matching `tool_use` block. Callers that force
  // a single tool via `tool_choice` should read this instead of `content`.
  tool_input?: unknown;
  usage: { input: number; output: number; cache_read?: number; cache_write?: number };
  model: string;
};

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  // SDK retries are disabled so our own retry loop is the single source of
  // truth — keeps log lines and timing correlate-able with attempt counts.
  cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return cachedClient;
}

// A "transient upstream" error: the model call itself failed (API error,
// connection failure, or our client-side timeout/abort) as opposed to the
// model returning unparseable output. Callers map this to a retriable
// 'upstream' reason. AbortError covers our per-attempt timeout (the SDK aborts
// the request via AbortController) and TimeoutError covers AbortSignal.timeout.
export function isUpstreamError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'AbortError' || name === 'TimeoutError';
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    // 5xx and 529 (overloaded) retryable; other 4xx terminal.
    return err.status >= 500 || err.status === 429;
  }
  // Aborts and unknown errors are not retried.
  return false;
}

// Pull the system message out of the AiMessage[] and convert to Anthropic's
// `system` parameter shape. Adds a cache_control breakpoint so the (large,
// stable) RECIPE_JSON_SHAPE preamble is served from cache after the first
// request in a lane.
function splitSystem(messages: AiMessage[]): {
  system: Anthropic.TextBlockParam[] | undefined;
  rest: Anthropic.MessageParam[];
} {
  const systemTexts: string[] = [];
  const rest: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemTexts.push(m.content);
      else for (const b of m.content) if (b.type === 'text') systemTexts.push(b.text);
      continue;
    }
    rest.push({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as Anthropic.ContentBlockParam[]),
    });
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

export async function aiChat(opts: AiCallOpts): Promise<AiResult> {
  // Mock mode short-circuits before the client is created, so no network call
  // to api.anthropic.com is ever made (and no API key is required).
  if (isMockMode()) return Promise.resolve(mockAiChat(opts));

  const client = getClient();
  const model = opts.model ?? laneModel(opts.lane);
  const { system, rest } = splitSystem(opts.messages);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: rest,
    ...(system ? { system } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.tool_choice ? { tool_choice: opts.tool_choice } : {}),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS[opts.lane]);
    try {
      const resp = await client.messages.create(params, { signal: ac.signal });
      clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);

      // Concatenate all text blocks; surface the first matching tool_use
      // block as `tool_input` when the caller forced a tool.
      const text = resp.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');
      let tool_input: unknown | undefined;
      if (opts.tools && opts.tools.length > 0) {
        const forcedName = opts.tool_choice && opts.tool_choice.type === 'tool'
          ? opts.tool_choice.name
          : undefined;
        for (const block of resp.content) {
          if (block.type !== 'tool_use') continue;
          if (forcedName && block.name !== forcedName) continue;
          tool_input = block.input;
          break;
        }
      }

      return {
        content: text,
        ...(tool_input !== undefined ? { tool_input } : {}),
        usage: {
          input: resp.usage.input_tokens ?? 0,
          output: resp.usage.output_tokens ?? 0,
          cache_read: resp.usage.cache_read_input_tokens ?? undefined,
          cache_write: resp.usage.cache_creation_input_tokens ?? undefined,
        },
        model: resp.model,
      };
    } catch (err) {
      clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt === MAX_RETRIES - 1) throw err;
      const jitter = Math.random() * 250;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]! + jitter));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('unreachable');
}
