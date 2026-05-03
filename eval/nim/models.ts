// Hand-edited config for the NIM eval harness. Change `candidates` to choose
// which models compete on the next run.

import { z } from 'zod';

export const CandidateSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  provider: z.enum(['nim', 'anthropic']).default('nim'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const EvalConfigSchema = z.object({
  candidates: z.array(CandidateSchema).min(1),
  concurrency: z.number().int().positive(),
  repeat: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

export const config: EvalConfig = EvalConfigSchema.parse({
  candidates: [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'nemotron-70b', provider: 'nim' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'llama-3.3-70b', provider: 'nim' },
    { id: 'claude-haiku-4-5-20251001', label: 'haiku-4.5', provider: 'anthropic' },
  ],
  concurrency: 2,
  repeat: 1,
  timeoutMs: 90_000,
});
