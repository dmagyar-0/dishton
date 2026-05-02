// Resolves the calling profile from the Authorization header. Edge Functions
// use this to scope DB writes per `auth.uid()`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from './env.ts';

export type CallerContext = {
  profileId: string;
  jwt: string;
  client: ReturnType<typeof createClient>;
};

export async function resolveCaller(req: Request): Promise<CallerContext> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'missing_authorization');
  }
  const jwt = auth.slice(7);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'app' },
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'invalid_jwt');
  return { profileId: data.user.id, jwt, client };
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

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    // supabase-js attaches `apikey` and `x-client-info` to every
    // functions.invoke call. Browsers preflight-block the POST if either is
    // missing here, leaving the SPA stuck on a request that never leaves.
    'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  };
}
