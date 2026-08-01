// Unit tests for recordAiUsage. Anthropic isn't involved here — only the
// service-role insert into app.ai_usage, mocked at the fetch layer the same
// way _shared/ai/validate_test.ts mocks the Anthropic call. Run via
// `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from './mock_fetch.ts';

// The env loader is lazy (a Proxy that loads on first access, which happens
// when aiUsageAdminClient() constructs the supabase-js client). Set the
// required secrets before any test runs; CI provides none for the edge suite.
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');

const { aiUsageAdminClient, recordAiUsage } = await import('./ai-usage.ts');

function baseRow() {
  return {
    function: 'import-url',
    lane: 'text' as const,
    model: 'claude-sonnet-5',
    profile_id: '11111111-1111-1111-1111-111111111111',
    household_id: '22222222-2222-2222-2222-222222222222',
    request_id: '33333333-3333-3333-3333-333333333333',
    import_job_id: '44444444-4444-4444-4444-444444444444',
    tokens_in: 1200,
    tokens_out: 400,
    cache_read: 50,
    cache_write: 0,
    latency_ms: 987,
    ok: true,
    reason: null,
  };
}

Deno.test('recordAiUsage posts the row to app.ai_usage', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('/rest/v1/ai_usage'),
      response: () => jsonResponse([], { status: 201 }),
    },
  ]);

  const row = baseRow();
  await recordAiUsage(aiUsageAdminClient(), row);

  assertEquals(mock.calls.length, 1);
  const req = mock.calls[0]!;
  assertEquals(req.method, 'POST');
  assert(req.url.includes('/rest/v1/ai_usage'));

  const parsed = JSON.parse(await req.text());
  const sent = Array.isArray(parsed) ? parsed[0] : parsed;
  assertEquals(sent.function, row.function);
  assertEquals(sent.lane, row.lane);
  assertEquals(sent.model, row.model);
  assertEquals(sent.profile_id, row.profile_id);
  assertEquals(sent.household_id, row.household_id);
  assertEquals(sent.request_id, row.request_id);
  assertEquals(sent.import_job_id, row.import_job_id);
  assertEquals(sent.tokens_in, row.tokens_in);
  assertEquals(sent.tokens_out, row.tokens_out);
  assertEquals(sent.cache_read, row.cache_read);
  assertEquals(sent.cache_write, row.cache_write);
  assertEquals(sent.latency_ms, row.latency_ms);
  assertEquals(sent.ok, row.ok);
  assertEquals(sent.reason, row.reason);
});

Deno.test('recordAiUsage swallows a failed insert (error response) without throwing', async () => {
  using _mock = installMockFetch([
    {
      match: (req) => req.url.includes('/rest/v1/ai_usage'),
      response: () =>
        jsonResponse(
          { message: 'permission denied for table ai_usage', code: '42501' },
          { status: 403 },
        ),
    },
  ]);

  // Must resolve, not throw or reject.
  await recordAiUsage(aiUsageAdminClient(), baseRow());
});

Deno.test('recordAiUsage swallows a rejected insert (network failure) without throwing', async () => {
  using _mock = installMockFetch([
    {
      match: (req) => req.url.includes('/rest/v1/ai_usage'),
      response: () => {
        throw new Error('network down');
      },
    },
  ]);

  // Must resolve, not throw or reject, even when the underlying fetch itself
  // rejects (as opposed to resolving with a non-2xx response).
  await recordAiUsage(aiUsageAdminClient(), baseRow());
});

Deno.test('recordAiUsage: ok:false / failure-call row shape (tokens 0, sentinel model)', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('/rest/v1/ai_usage'),
      response: () => jsonResponse([], { status: 201 }),
    },
  ]);

  const row = {
    function: 'import-photo',
    lane: 'vision' as const,
    model: '(unknown)',
    profile_id: '11111111-1111-1111-1111-111111111111',
    household_id: '22222222-2222-2222-2222-222222222222',
    request_id: '33333333-3333-3333-3333-333333333333',
    import_job_id: '44444444-4444-4444-4444-444444444444',
    tokens_in: 0,
    tokens_out: 0,
    cache_read: 0,
    cache_write: 0,
    latency_ms: 55,
    ok: false,
    reason: 'upstream',
  };
  await recordAiUsage(aiUsageAdminClient(), row);

  const parsed = JSON.parse(await mock.calls[0]!.text());
  const sent = Array.isArray(parsed) ? parsed[0] : parsed;
  assertEquals(sent.ok, false);
  assertEquals(sent.reason, 'upstream');
  assertEquals(sent.model, '(unknown)');
  assertEquals(sent.tokens_in, 0);
  assertEquals(sent.tokens_out, 0);
});
