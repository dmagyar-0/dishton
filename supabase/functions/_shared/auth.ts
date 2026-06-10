// Resolves the calling profile from the Authorization header. Edge Functions
// use this to scope DB writes per `auth.uid()`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from './env.ts';

// Caller-scoped client opts into the `app` schema explicitly. Type the schema
// generic so `ReturnType<typeof resolveCaller>` lines up with the runtime
// client; otherwise PostgREST writes that target `app.*` look like writes
// against `public.*` to the type checker.
export type AppClient = ReturnType<typeof createClient<any, 'app'>>;

export type CallerContext = {
  profileId: string;
  jwt: string;
  client: AppClient;
};

export async function resolveCaller(req: Request): Promise<CallerContext> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'missing_authorization');
  }
  const jwt = auth.slice(7);
  const client = createClient<any, 'app'>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'app' },
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'invalid_jwt');
  return { profileId: data.user.id, jwt, client };
}

// Read the caller's preferred language from app.profiles. Used by the import
// Edge Functions to thread the structuring prompt's targetLanguage. Falls back
// to 'en' on any miss — matches the column default and keeps a missing/loading
// profile from blocking imports.
export async function getCallerPreferredLanguage(
  client: AppClient,
  profileId: string,
): Promise<string> {
  const { data } = await client
    .from('profiles')
    .select('preferred_language')
    .eq('id', profileId)
    .maybeSingle();
  return (data?.preferred_language as string | undefined) ?? 'en';
}

// Assert the caller belongs to the household they are targeting. RLS already
// confines the sensitive writes (save_recipe et al. re-check editorship), but
// the import/chat functions accept a client-chosen household_id and should
// fail fast with a clear 403 instead of leaking a generic 500 from a deeper
// RLS denial. Reads through the caller-scoped client, so RLS itself answers.
export async function assertHouseholdMember(
  client: AppClient,
  profileId: string,
  householdId: string,
): Promise<void> {
  const { data } = await client
    .from('household_members')
    .select('household_id')
    .eq('household_id', householdId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!data) throw new HttpError(403, 'not_household_member');
}

// Read the household's allowed tag whitelist. The structuring prompt is
// constrained to pick tags only from this list — see
// supabase/functions/_shared/ai/prompts.ts. RLS restricts the row to members
// of the household, so a non-member call returns no row and we fall back to
// an empty array (the prompt will then emit no tags rather than break).
export async function getHouseholdAllowedTags(
  client: AppClient,
  householdId: string,
): Promise<string[]> {
  const { data } = await client
    .from('households')
    .select('allowed_tags')
    .eq('id', householdId)
    .maybeSingle();
  const raw = (data as { allowed_tags?: unknown } | null)?.allowed_tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string');
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, public extra?: Record<string, unknown>) {
    super(`${status} ${code}`);
  }
  toResponse(): Response {
    return new Response(
      JSON.stringify({ error: this.code, ...(this.extra ?? {}) }),
      {
        status: this.status,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// Parse the ALLOWED_ORIGINS secret (comma-separated origins). null means "not
// configured" — local stacks and tests then keep the permissive echo below.
export function parseAllowedOrigins(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function configuredOrigins(): string[] | null {
  // env throws on missing REQUIRED vars; tests run without any of them set,
  // and an unconfigured allowlist must not take the function down.
  try {
    return parseAllowedOrigins(env.ALLOWED_ORIGINS);
  } catch {
    return null;
  }
}

export function corsHeaders(
  origin: string | null,
  allowedOrigins?: string[] | null,
): Record<string, string> {
  const allowlist = allowedOrigins === undefined ? configuredOrigins() : allowedOrigins;
  // With ALLOWED_ORIGINS set (production), only echo a known origin; an
  // unknown one gets the first allowed entry, which makes the browser fail
  // the CORS check instead of granting a reflected wildcard. These endpoints
  // authenticate via the Authorization header (no cookies), so this is
  // defence in depth rather than a CSRF gate.
  const allowOrigin =
    allowlist === null
      ? (origin ?? '*')
      : origin !== null && allowlist.includes(origin)
        ? origin
        : (allowlist[0] ?? '*');
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    // supabase-js attaches `apikey` and `x-client-info` to every
    // functions.invoke call. Browsers preflight-block the POST if either is
    // missing here, leaving the SPA stuck on a request that never leaves.
    'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  };
}
