// Structured JSON log lines for Better Stack (Logtail) drain.
// One object per call; stdout is captured by Supabase and forwarded.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = {
  request_id: string;
  profile_id: string | null;
  household_id: string | null;
  function: string;
  event: string;
  level?: LogLevel;
  latency_ms?: number | null;
  ai_tokens_in?: number | null;
  ai_tokens_out?: number | null;
  ai_cache_read?: number | null;
  ai_cache_write?: number | null;
  ai_model?: string | null;
  error?: { name: string; message: string; stack?: string } | null;
  [key: string]: unknown;
};

export function log(fields: LogFields): void {
  const line = {
    timestamp: new Date().toISOString(),
    level: fields.level ?? 'info',
    ...fields,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function logAiCall(fields: {
  request_id: string;
  function: string;
  lane: 'text' | 'vision';
  model: string;
  ms: number;
  tokens_in: number;
  tokens_out: number;
  cache_read?: number;
  cache_write?: number;
  ok: boolean;
  reason?: string;
}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ kind: 'ai_call', ...fields }));
}
