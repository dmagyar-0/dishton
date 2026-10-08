// Anthropic client wrapper. Authenticates with the Anthropic SDK, retries on
// 5xx and 429 with backoff + jitter, never on other 4xx, surfaces typed
// errors. Per-lane default model: Haiku 5.5 for text, Sonnet 5.5 for vision
// (eval round 3).
//
// Edge-function only — never imported from the SPA bundle.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import { env } from '../env.ts';
import { isMockMode, mockAiChat } from './mock.ts';

export type Lane = 'text' | 'vision';

// Per-lane default model. Text defaults to Haiku 5.5: eval round 3
// (eval/round-3/README.md) found it matches or beats Haiku 4.5 on the URL and
// caption lanes at a tenth of the price. Vision defaults to Sonnet 5.5: on the
// cookbook-matrix photos it was clean in 6/6 runs (right column, every
// ingredient, handwritten amounts, no variant-only steps), better than Sonnet
// 4.6 and Haiku 5.5, at $2/$10 vs Sonnet 4.6's $3/$15. Thinking stays off.
// Override per lane via ANTHROPIC_MODEL (text) / ANTHROPIC_MODEL_VISION (vision).
const DEFAULT_MODEL: Record<Lane, string> = {
  text: 'claude-haiku-5-5',
  vision: 'claude-sonnet-5-5',
};

function laneModel(lane: Lane): string {
  const override = lane === 'vision' ? env.ANTHROPIC_MODEL_VISION : env.ANTHROPIC_MODEL;
  return override ?? DEFAULT_MODEL[lane];
}

// Newer models reject (400) two things the older ones need: a forced
// `tool_choice` ({type:'tool'|'any'}), and `thinking: {type:'disabled'}`.
// Keyed by model prefix so an ANTHROPIC_MODEL[_VISION] override still gets a
// request shape the model accepts.
const NO_FORCED_TOOL = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'];
const ALWAYS_THINKS = ['claude-opus-5-5', 'claude-fable-5', 'claude-mythos-5'];

const isAny = (model: string, prefixes: string[]) => prefixes.some((p) => model.startsWith(p));

// Thinking off wherever the model allows it: eval round 2 found it adds
// cost/latency with no extraction gain, and Haiku 5.5 would otherwise think by
// default (eating into max_tokens on the untooled translate call). Sonnet 5.5
// spells "off" as `between_tools`; Opus 5.5 / Fable can't turn it off at all.
export function thinkingFor(model: string): Record<string, unknown> | undefined {
  if (model.startsWith('claude-sonnet-5-5')) return { type: 'between_tools' };
  if (isAny(model, ALWAYS_THINKS)) return undefined;
  return { type: 'disabled' };
}

// Downgrade a forced tool_choice to `auto` where the model rejects forcing.
// The prompt already says to call extract_recipe; callAndValidate retries
// once if the model answers without the tool.
export function toolChoiceFor(
  model: string,
  choice?: Anthropic.ToolChoice,
): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if ((choice.type === 'tool' || choice.type === 'any') && isAny(model, NO_FORCED_TOOL)) {
    return { type: 'auto' };
  }
  return choice;
}

// Haiku 5.5's tokenizer counts the same text as ~30% more tokens than Haiku
// 4.5, so the old 4096 cap could truncate a long recipe's tool call.
const MAX_OUTPUT_TOKENS = 8192;

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
  // The fetch indirection routes every request through the *current*
  // globalThis.fetch at call time (rather than the reference the SDK captures
  // at import) so test-time fetch mocks (_shared/mock_fetch.ts) intercept SDK
  // traffic. Behaviour-neutral in production, where globalThis.fetch is the
  // platform fetch.
  // The SDK's Fetch type is keyed to node-fetch's Request/Response; bridge to
  // the platform fetch through `unknown`. The wrapper itself uses Deno DOM
  // types, so the call is type-safe.
  type SdkFetch = NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch'];
  const fetchThroughGlobal = ((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init)) as unknown as SdkFetch;
  cachedClient = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 0,
    fetch: fetchThroughGlobal,
  });
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
// `system` parameter shape. Deliberately NOT prompt-cached: imports are
// sporadic (minutes to hours apart), so a cache entry almost always expires
// unread and every call would pay the 1.25x cache-write premium for nothing.
// Haiku 5.5's 512-token minimum would otherwise make the ~2k-token system
// prompt cacheable on every request.
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
    system: [{ type: 'text', text: systemTexts.join('\n\n') }],
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

  const thinking = thinkingFor(model);
  const toolChoice = toolChoiceFor(model, opts.tool_choice);
  // No temperature: Haiku 5.5 / Sonnet 5.5 reject non-default sampling params.
  // Cast because the pinned SDK's types predate `between_tools`.
  const params = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: rest,
    ...(system ? { system } : {}),
    ...(thinking ? { thinking } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  } as Anthropic.MessageCreateParamsNonStreaming;

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
