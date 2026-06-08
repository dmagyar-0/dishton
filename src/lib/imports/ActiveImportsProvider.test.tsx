import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories (themselves hoisted
// above imports) can reference it safely.
const h = vi.hoisted(() => ({
  liveRows: [] as unknown[],
  terminalRows: [] as unknown[],
  pushed: [] as Array<{ title: string }>,
  fromCalls: 0,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/ui/primitives/Toast', () => ({
  useToast: () => ({ push: (toast: { title: string }) => h.pushed.push(toast) }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: (sel: (s: { profile: { id: string } | null }) => unknown) => sel({ profile: { id: 'p1' } }),
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
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

import { ActiveImportsProvider } from './ActiveImportsProvider';

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

beforeEach(() => {
  h.liveRows = [];
  h.terminalRows = [];
  h.pushed.length = 0;
  h.fromCalls = 0;
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

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
