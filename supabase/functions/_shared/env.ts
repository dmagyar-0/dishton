// Typed env loader for Edge Functions. Throws on missing required values
// during cold start so deploy-time misconfigurations surface immediately.

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const OPTIONAL = [
  'ANTHROPIC_MODEL',
  'IG_OEMBED_TOKEN',
  'LOG_DRAIN_TOKEN',
  'AI_MOCK_MODE',
  'SENTRY_DSN_FUNCTIONS',
] as const;

type RequiredKey = (typeof REQUIRED)[number];
type OptionalKey = (typeof OPTIONAL)[number];

type Env = { [K in RequiredKey]: string } & { [K in OptionalKey]: string | undefined };

function read(key: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  if (d && typeof d.env?.get === 'function') return d.env.get(key) ?? undefined;
  // Fallback for type checking under Vitest/Node where Deno isn't defined.
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.[key];
}

function load(): Env {
  const out: Record<string, string | undefined> = {};
  const missing: string[] = [];
  for (const key of REQUIRED) {
    const v = read(key);
    if (!v) missing.push(key);
    out[key] = v;
  }
  if (missing.length > 0) {
    throw new Error(`missing required env: ${missing.join(', ')}`);
  }
  for (const key of OPTIONAL) {
    out[key] = read(key);
  }
  return out as Env;
}

let cached: Env | null = null;
export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    if (cached === null) cached = load();
    return cached[prop as keyof Env];
  },
});
