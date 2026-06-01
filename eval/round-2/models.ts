// Round-2 candidate grid (Q1: recommended 5-config grid). `haiku` is today's
// production config (Haiku 4.5, no thinking, forced tool use). The others probe
// whether a bigger model and/or adaptive thinking help — especially on the
// Stage-3 matrix photo.
//
// Effort is only set on the thinking configs (Haiku 4.5 rejects `effort`; the
// no-thinking Sonnet/Opus baselines use the server default). Thinking configs
// get a higher max_tokens because adaptive-thinking tokens count toward output.

import type { Effort } from './anthropic.ts';

export type Candidate = {
  label: string;
  model: string;
  thinking?: 'adaptive';
  effort?: Effort;
  maxTokens?: number;
};

export const CANDIDATES: Candidate[] = [
  { label: 'haiku', model: 'claude-haiku-4-5' },
  { label: 'sonnet', model: 'claude-sonnet-4-6' },
  {
    label: 'sonnet-think',
    model: 'claude-sonnet-4-6',
    thinking: 'adaptive',
    // R2.0 showed effort:high on Sonnet 4.6 + full HTML → 200s+ latencies and
    // tool-JSON truncation (thinking ate the token budget). medium is the
    // documented sweet spot; 20k max_tokens leaves room for the recipe output.
    effort: 'medium',
    maxTokens: 20_000,
  },
  { label: 'opus', model: 'claude-opus-4-8' },
  {
    label: 'opus-think',
    model: 'claude-opus-4-8',
    thinking: 'adaptive',
    effort: 'medium',
    maxTokens: 20_000,
  },
];

// concurrency 2: tier hit 429s at 3. timeout 300s: thinking on big inputs is slow.
export const RUN_DEFAULTS = { repeat: 3, concurrency: 2, timeoutMs: 300_000 };
