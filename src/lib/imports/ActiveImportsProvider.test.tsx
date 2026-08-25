import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories (themselves hoisted
// above imports) can reference it safely.
const h = vi.hoisted(() => ({
  liveRows: [] as unknown[],
  terminalRows: [] as unknown[],
  pushed: [] as Array<{ title: string; description?: unknown }>,
  fromCalls: 0,
  subscribes: 0,
  removes: 0,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/ui/primitives/Toast', () => ({
  useToast: () => ({
    push: (toast: { title: string; description?: unknown }) => h.pushed.push(toast),
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: (sel: (s: { profile: { id: string } | null }) => unknown) =>
    sel({ profile: { id: 'p1' } }),
}));
vi.mock('@/observability/breadcrumbs', () => ({ bcImportSaveFailed: () => {} }));

// A thenable query builder: every chain method returns the builder; awaiting it
// resolves to liveRows, unless `.gt(...)` was called (the terminal-backfill
// query), in which case it resolves to terminalRows.
vi.mock('@/lib/supabase', () => {
  const make = () => {
    const state = { terminal: false };
    const result = () =>
      Promise.resolve({ data: state.terminal ? h.terminalRows : h.liveRows, error: null });
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.in = () => b;
    b.update = () => b;
    b.gt = () => {
      state.terminal = true;
      return b;
    };
    // Both backfill queries terminate in .order(); resolve there. The terminal
    // query is distinguished by a preceding .gt() call.
    b.order = () => result();
    return b;
  };
  return {
    supabase: {
      from: () => {
        h.fromCalls += 1;
        return make();
      },
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({
        on: () => ({
          subscribe: () => {
            h.subscribes += 1;
            return {};
          },
        }),
      }),
      removeChannel: () => {
        h.removes += 1;
      },
    },
  };
});

import de from '@/lib/i18n.de';
import en from '@/lib/i18n.en';
import hu from '@/lib/i18n.hu';
import { ActiveImportsProvider, failedErrorKey } from './ActiveImportsProvider';

const doneRow = {
  id: 'j1',
  household_id: 'h1',
  kind: 'url',
  status: 'done',
  phase: null,
  progress_text: null,
  recipe_id: 'r1',
  payload: { url: 'https://x.test/a', draft: { title: 'Tarte' } },
  error: null,
  created_at: '2026-06-02T00:00:00.000Z',
  completed_at: '2026-06-02T00:00:00.000Z',
};

const failedRow = {
  id: 'j2',
  household_id: 'h1',
  kind: 'instagram',
  status: 'failed',
  phase: 'ai',
  progress_text: 'Asking the model',
  recipe_id: null,
  payload: { url: 'https://www.instagram.com/reel/Abc123/', latency_ms: 3200 },
  error: 'caption_no_recipe',
  created_at: '2026-06-02T00:00:00.000Z',
  completed_at: '2026-06-02T00:00:00.000Z',
};

beforeEach(() => {
  h.liveRows = [];
  h.terminalRows = [];
  h.pushed.length = 0;
  h.fromCalls = 0;
  h.subscribes = 0;
  h.removes = 0;
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('failedErrorKey', () => {
  // The edge function writes `caption_no_recipe` for an Instagram post whose
  // caption carries no recipe (the recipe is only in the video). That code has
  // to survive the round trip: written by import-instagram, mapped here, and
  // present in every locale — otherwise the user silently gets the generic
  // "something went wrong" instead of the reason they can act on.
  it('maps caption_no_recipe to its own message rather than the generic one', () => {
    expect(failedErrorKey('caption_no_recipe')).toBe('errors.caption_no_recipe');
  });

  it('keeps the generic empty code distinct from the Instagram-specific one', () => {
    expect(failedErrorKey('empty')).toBe('errors.empty');
  });

  it('falls back to errors.internal for an unknown or missing code', () => {
    expect(failedErrorKey('something_new')).toBe('errors.internal');
    expect(failedErrorKey(null)).toBe('errors.internal');
    expect(failedErrorKey(undefined)).toBe('errors.internal');
  });

  it('has a string for every locale', () => {
    for (const messages of [en, de, hu]) {
      expect(messages.errors.caption_no_recipe).toBeTruthy();
    }
  });
});

describe('ActiveImportsProvider reopen pop-up', () => {
  it('announces a terminal import that completed past the stored mark', async () => {
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-01T00:00:00.000Z');
    h.terminalRows = [doneRow];
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    await waitFor(() =>
      expect(h.pushed.some((toast) => toast.title === 'import.away_ready_title')).toBe(true),
    );
    // Mark advanced to the announced row's completed_at.
    expect(localStorage.getItem('dishton:imports:lastNotified:p1')).toBe(
      '2026-06-02T00:00:00.000Z',
    );
  });

  it('reconnects the channel and re-runs the backfill on a mobile resume', async () => {
    // A backgrounded Android tab freezes: the Realtime socket is dropped and any
    // import that finishes while away is never delivered. On resume the provider
    // must re-subscribe on a fresh socket AND re-query for missed rows.
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    // Initial mount: backfill ran (live + terminal = 2 from() calls) and the
    // channel subscribed once.
    await waitFor(() => expect(h.fromCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(h.subscribes).toBe(1));
    const callsAfterMount = h.fromCalls;

    // `resume` is the definitive Page Lifecycle "we were frozen" signal and
    // bypasses the hidden-duration gate.
    act(() => {
      document.dispatchEvent(new Event('resume'));
    });

    // Old channel torn down, fresh one subscribed, backfill re-run.
    await waitFor(() => expect(h.removes).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(h.subscribes).toBe(2));
    await waitFor(() => expect(h.fromCalls).toBeGreaterThan(callsAfterMount));
  });

  it('names the reason when a single import failed while away', async () => {
    // Background imports exist so the user can close the app, so meeting a
    // failure on reopen is normal. The count summary ("1 import(s) couldn't be
    // finished") gives them nothing to act on — for an Instagram caption with
    // no recipe in it, the difference is knowing not to retry the same link.
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-01T00:00:00.000Z');
    h.terminalRows = [failedRow];
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    await waitFor(() =>
      expect(h.pushed.some((toast) => toast.description === 'errors.caption_no_recipe')).toBe(true),
    );
    expect(h.pushed.some((toast) => toast.description === 'import.away_summary_failed')).toBe(
      false,
    );
  });

  it('keeps the count summary when several imports failed while away', async () => {
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-01T00:00:00.000Z');
    h.terminalRows = [failedRow, { ...failedRow, id: 'j3', error: 'empty' }];
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    await waitFor(() =>
      expect(h.pushed.some((toast) => toast.title === 'import.away_summary_title')).toBe(true),
    );
    // Two different reasons can't be named in one line, so it stays a count.
    expect(h.pushed.some((toast) => toast.description === 'errors.caption_no_recipe')).toBe(false);
  });

  it('leaves a lone needs_review row on the summary rather than guessing a reason', async () => {
    // needs_review carries its reason in payload.reason, not in `error`, so
    // naming it here would resolve to errors.internal — a wrong message is
    // worse than a vague one.
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-01T00:00:00.000Z');
    h.terminalRows = [{ ...failedRow, id: 'j4', status: 'needs_review', error: null }];
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    await waitFor(() =>
      expect(h.pushed.some((toast) => toast.title === 'import.away_summary_title')).toBe(true),
    );
    expect(h.pushed.some((toast) => toast.description === 'errors.internal')).toBe(false);
  });

  it('does not announce when nothing is newer than the mark', async () => {
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-09T00:00:00.000Z');
    h.terminalRows = [];
    render(
      <ActiveImportsProvider>
        <div />
      </ActiveImportsProvider>,
    );
    // Wait until both mount queries (live + terminal) have run, then assert silence.
    await waitFor(() => expect(h.fromCalls).toBeGreaterThanOrEqual(2));
    expect(h.pushed.length).toBe(0);
    expect(localStorage.getItem('dishton:imports:lastNotified:p1')).toBe(
      '2026-06-09T00:00:00.000Z',
    );
  });
});
