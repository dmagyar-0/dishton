// Background-mode import tracking. The provider opens one Realtime channel
// scoped to the current profile and reflects every running / awaiting_save /
// terminal `app.import_jobs` row into in-memory state, so the shell pill
// can render across route changes and the listener can auto-save imports
// that completed while the SPA was on a different page.
//
// The provider is mounted in src/routes/__root.tsx ABOVE <AppShell /> so it
// survives every navigation; the channel opens on first sign-in and stays
// open for the session.

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { bcImportSaveFailed } from '@/observability/breadcrumbs';
import { useToast } from '@/ui/primitives/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

export type ImportKind = 'url' | 'instagram' | 'photo' | 'manual';
export type ImportPhase = 'scrape' | 'ai' | 'saving' | null;
export type ImportStatus =
  | 'queued'
  | 'running'
  | 'awaiting_save'
  | 'done'
  | 'needs_review'
  | 'failed';

export type ActiveImport = {
  jobId: string;
  householdId: string;
  kind: ImportKind;
  status: ImportStatus;
  phase: ImportPhase;
  progressText: string | null;
  recipeId: string | null;
  // Source URL for url/instagram imports (from payload.url); null for photos.
  sourceUrl: string | null;
  // Set when the SPA originated this import (vs. one started in another tab).
  // Used by the import page to decide whether to dismiss its own modal on
  // status flips.
  origin: 'this-tab' | 'realtime';
  createdAt: string;
  completedAt: string | null;
};

type Row = {
  id: string;
  household_id: string;
  kind: ImportKind;
  status: ImportStatus;
  phase?: ImportPhase;
  progress_text?: string | null;
  recipe_id: string | null;
  payload?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  completed_at: string | null;
};

// Server `error` codes that have a dedicated user-facing i18n string under
// `errors.*`. Anything else (or null) falls back to errors.internal.
// Server `error` codes that have a dedicated user-facing i18n string under
// `errors.*`. With every import now finishing in the background, more failure
// reasons reach the SPA via realtime instead of as a synchronous HTTP error,
// so map all of them. Anything unknown falls back to errors.internal.
const KNOWN_FAILED_CODES = new Set([
  'rate_limit',
  'upstream',
  'timeout',
  'fetch_failed',
  'invalid_url',
  'not_html',
  'source_too_large',
  'instagram_unavailable',
  'empty',
  'object_not_found',
  'forbidden_path',
  'not_image',
  'photo_too_large',
  'network',
]);

function failedErrorKey(code: string | null | undefined): string {
  return code && KNOWN_FAILED_CODES.has(code) ? `errors.${code}` : 'errors.internal';
}

type RegisterArgs = {
  jobId: string;
  householdId: string;
  kind: ImportKind;
  sourceUrl?: string | null;
};

type ActiveImportsContextValue = {
  items: ActiveImport[];
  register: (args: RegisterArgs) => void;
  dismiss: (jobId: string) => void;
};

const ActiveImportsContext = createContext<ActiveImportsContextValue | null>(null);

// Cap how many completed rows we hold in memory. Active rows are never
// pruned; only `done`/`failed`/`needs_review` get expired after this delay
// so the indicator can briefly show "just finished" before disappearing.
const COMPLETED_TTL_MS = 30_000;

// localStorage key holding the completed_at of the most recent terminal import
// this device has already announced. Lets a reopen surface only completions
// that happened while the app wasn't listening.
function lastNotifiedKey(profileId: string): string {
  return `dishton:imports:lastNotified:${profileId}`;
}

function draftTitle(row: Row): string | null {
  const draft = (row.payload as { draft?: { title?: string } } | null | undefined)?.draft;
  return draft?.title ?? null;
}

function rowToActive(row: Row, origin: ActiveImport['origin']): ActiveImport {
  return {
    jobId: row.id,
    householdId: row.household_id,
    kind: row.kind,
    status: row.status,
    phase: (row.phase ?? null) as ImportPhase,
    progressText: row.progress_text ?? null,
    recipeId: row.recipe_id ?? null,
    sourceUrl: (row.payload as { url?: string } | null | undefined)?.url ?? null,
    origin,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function ActiveImportsProvider({ children }: { children: ReactNode }) {
  const profileId = useAuth((s) => s.profile?.id ?? null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { push } = useToast();
  const [items, setItems] = useState<ActiveImport[]>([]);
  // Track which jobIds the current tab originated; prevents a duplicate
  // toast when the synchronous response handler navigates the user to the
  // recipe page while Realtime is also delivering the same event.
  const [originated] = useState<Set<string>>(() => new Set());
  // Track which jobIds we've already saved to keep the listener idempotent
  // (a row can transition awaiting_save → done within the same tab; we
  // must not double-save).
  const [saved] = useState<Set<string>>(() => new Set());
  // Bumped when the app returns to the foreground after a real backgrounding.
  // Feeding it into the subscribe effect below forces a full channel teardown +
  // re-subscribe AND a re-run of the backfill query — see the effect comment.
  const [resumeNonce, setResumeNonce] = useState(0);

  // Recover the import pipeline after a mobile resume. Android Chrome freezes a
  // long-backgrounded tab: the Realtime WebSocket heartbeat is throttled, the
  // socket is dropped, and any import that finishes while we're away is never
  // delivered to the live listener — so the user comes back to an import that
  // looks stuck and "can't import". On return we bump resumeNonce, which both
  // re-subscribes the channel on a fresh socket and re-runs the one-time
  // backfill that re-drives every awaiting_save/done row missed while we were
  // frozen. This mirrors session-recovery.ts (auth + on-screen queries); the
  // import channel needs its own resume handling because that module doesn't
  // touch Realtime.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // Only recover after a real backgrounding, not a momentary blur, matching
    // session-recovery.ts so the two stay in lockstep.
    const MIN_HIDDEN_MS = 10_000;
    // Collapse the burst of resume events the browser fires together.
    const DEBOUNCE_MS = 2_000;
    let hiddenAt: number | null = null;
    let lastBump = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastBump < DEBOUNCE_MS) return;
      lastBump = now;
      setResumeNonce((n) => n + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? Number.POSITIVE_INFINITY : Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor >= MIN_HIDDEN_MS) bump();
    };
    // Page Lifecycle freeze/resume: `resume` is the definitive "we were frozen"
    // signal, so reconnect unconditionally.
    const onFreeze = () => {
      hiddenAt = Date.now();
    };
    const onResume = () => bump();
    const onOnline = () => bump();
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const upsert = useCallback((row: Row, origin: ActiveImport['origin']) => {
    setItems((prev) => {
      const next = [...prev];
      const idx = next.findIndex((it) => it.jobId === row.id);
      const existing = idx >= 0 ? next[idx] : undefined;
      // Once a tab claims origin, keep it across updates.
      const incoming = rowToActive(row, existing?.origin ?? origin);
      if (existing) next[idx] = incoming;
      else next.unshift(incoming);
      return next;
    });
  }, []);

  const dismiss = useCallback((jobId: string) => {
    setItems((prev) => prev.filter((it) => it.jobId !== jobId));
  }, []);

  // Advance the per-device high-water-mark so a reopen never re-announces a
  // terminal import the user already saw (live or via a prior backfill).
  const bumpMark = useCallback(
    (completedAt: string | null | undefined) => {
      if (!profileId || !completedAt) return;
      const key = lastNotifiedKey(profileId);
      const prev = localStorage.getItem(key);
      if (!prev || completedAt > prev) localStorage.setItem(key, completedAt);
    },
    [profileId],
  );

  const register = useCallback(
    ({ jobId, householdId, kind, sourceUrl }: RegisterArgs) => {
      originated.add(jobId);
      // Optimistic insert so the indicator renders immediately, before the
      // Realtime channel delivers the INSERT event for this row.
      setItems((prev) => {
        if (prev.some((it) => it.jobId === jobId)) return prev;
        const now = new Date().toISOString();
        const optimistic: ActiveImport = {
          jobId,
          householdId,
          kind,
          status: 'running',
          phase: 'scrape',
          progressText: null,
          recipeId: null,
          sourceUrl: sourceUrl ?? null,
          origin: 'this-tab',
          createdAt: now,
          completedAt: null,
        };
        return [optimistic, ...prev];
      });
    },
    [originated],
  );

  // Save the draft when a row transitions into awaiting_save. The edge
  // function wrote the validated draft into payload.draft; we call
  // save_recipe with the SPA's fresh JWT (the existing "edge functions
  // never write app.recipes" rule), then patch the row to done + recipe_id.
  const saveFromAwaiting = useCallback(
    async (row: Row) => {
      if (saved.has(row.id)) return;
      saved.add(row.id);
      const draft = (row.payload as { draft?: unknown } | null)?.draft;
      if (!draft) {
        saved.delete(row.id);
        return;
      }
      const { data: newId, error } = await supabase.rpc('save_recipe', {
        p_household: row.household_id,
        p_draft: draft as never,
      });
      if (error || !newId) {
        bcImportSaveFailed({
          code: error?.code ?? null,
          message: error?.message ?? null,
          details: error?.details ?? null,
          hint: error?.hint ?? null,
        });
        push({
          variant: 'error',
          title: t('import.error_title'),
          description: t('errors.internal'),
        });
        // Allow another tab / a retry to attempt the save.
        saved.delete(row.id);
        return;
      }
      await supabase
        .from('import_jobs')
        .update({ status: 'done', recipe_id: newId })
        .eq('id', row.id);
      await queryClient.invalidateQueries({ queryKey: ['recipes', row.household_id] });
      // Always toast: this branch only fires for background-mode imports
      // (sync mode writes status='done' on the server and never produces
      // an awaiting_save event), so there's no duplicate-toast risk.
      push({
        variant: 'success',
        title: t('import.ready_title'),
        description: (
          <button
            type="button"
            className="underline"
            onClick={() => {
              navigate({
                to: '/h/$householdId/r/$recipeId',
                params: { householdId: row.household_id, recipeId: newId as string },
              });
            }}
          >
            {t('import.ready_view_recipe')}
          </button>
        ),
      });
    },
    [navigate, push, queryClient, saved, t],
  );

  // Surface terminal imports that completed while this device wasn't listening,
  // as a persistent pop-up on reopen. A single `done` links straight to the
  // recipe; multiple/mixed results are summarised.
  const announceAway = useCallback(
    (rows: Row[]) => {
      const done = rows.filter((r) => r.status === 'done' && r.recipe_id);
      const failed = rows.filter((r) => r.status === 'failed' || r.status === 'needs_review');
      if (done.length === 1 && failed.length === 0) {
        const row = done[0];
        if (!row) return;
        const title = draftTitle(row);
        const recipeId = row.recipe_id as string;
        const householdId = row.household_id;
        push({
          variant: 'success',
          persist: true,
          title: t('import.away_ready_title'),
          description: (
            <button
              type="button"
              className="underline"
              onClick={() => {
                navigate({
                  to: '/h/$householdId/r/$recipeId',
                  params: { householdId, recipeId },
                });
              }}
            >
              {title ? t('import.away_ready_body', { title }) : t('import.ready_view_recipe')}
            </button>
          ),
        });
        return;
      }
      if (done.length === 0 && failed.length === 0) return;
      push({
        variant: failed.length > 0 && done.length === 0 ? 'error' : 'info',
        persist: true,
        title: t('import.away_summary_title'),
        description: [
          done.length > 0 ? t('import.away_summary_done', { count: done.length }) : null,
          failed.length > 0 ? t('import.away_summary_failed', { count: failed.length }) : null,
        ]
          .filter(Boolean)
          .join(' '),
      });
    },
    [navigate, push, t],
  );

  // Subscribe once per session per profile. Re-subscribes when the user
  // signs in as a different account.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resumeNonce is a deliberate re-run trigger (reconnect channel + re-backfill on mobile resume), not read in the effect body.
  useEffect(() => {
    if (!profileId) {
      setItems([]);
      originated.clear();
      saved.clear();
      return;
    }
    // Backfill on mount: Realtime only delivers CHANGE events, so any
    // awaiting_save / running / queued row that already existed before this
    // tab subscribed (e.g. a background import that finished while every tab
    // was closed) is invisible to the listener and would sit forever, counting
    // against the concurrency cap. Query existing live rows once and re-drive
    // them — re-saving any awaiting_save draft and rendering the indicator.
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('import_jobs')
        .select(
          'id, household_id, kind, status, phase, progress_text, recipe_id, payload, error, created_at, completed_at',
        )
        .eq('profile_id', profileId)
        .in('status', ['queued', 'running', 'awaiting_save'])
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (data) {
        for (const r of data as Row[]) {
          upsert(r, 'realtime');
          if (r.status === 'awaiting_save') void saveFromAwaiting(r);
        }
      }

      // Reopen pop-up: announce terminal imports completed past the mark. On a
      // device's first run we set the mark to "now" so we never replay history.
      const markKey = lastNotifiedKey(profileId);
      let mark = localStorage.getItem(markKey);
      if (mark === null) {
        mark = new Date().toISOString();
        localStorage.setItem(markKey, mark);
      }
      const { data: terminal } = await supabase
        .from('import_jobs')
        .select(
          'id, household_id, kind, status, phase, progress_text, recipe_id, payload, error, created_at, completed_at',
        )
        .eq('profile_id', profileId)
        .in('status', ['done', 'failed', 'needs_review'])
        .gt('completed_at', mark)
        .order('completed_at', { ascending: true });
      if (cancelled || !terminal || terminal.length === 0) return;
      for (const r of terminal as Row[]) upsert(r, 'realtime');
      announceAway(terminal as Row[]);
      const newest = (terminal as Row[])[terminal.length - 1]?.completed_at;
      if (newest) localStorage.setItem(markKey, newest);
    })();

    const channel = supabase
      .channel(`import_jobs:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'app',
          table: 'import_jobs',
          filter: `profile_id=eq.${profileId}`,
        },
        (payload) => {
          const row = payload.new as Row;
          if (!row?.id) return;
          upsert(row, 'realtime');
          if (row.status === 'done' || row.status === 'failed' || row.status === 'needs_review') {
            bumpMark(row.completed_at);
          }
          if (row.status === 'awaiting_save') {
            void saveFromAwaiting(row);
          } else if (row.status === 'needs_review' && !originated.has(row.id)) {
            // Sync handler shows its own needs_review toast; only surface
            // background-mode reviews here.
            push({
              variant: 'error',
              title: t('import.needs_review_title'),
              description: t('import.needs_review_body'),
            });
          } else if (row.status === 'failed' && !originated.has(row.id)) {
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t(failedErrorKey(row.error)),
            });
          }
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
    // resumeNonce: re-run on mobile resume to reconnect the channel on a fresh
    // socket and re-backfill rows missed while the tab was frozen.
  }, [
    profileId,
    resumeNonce,
    originated,
    saved,
    upsert,
    saveFromAwaiting,
    announceAway,
    bumpMark,
    push,
    t,
  ]);

  // Prune terminal rows after the TTL so the indicator naturally clears.
  useEffect(() => {
    if (items.length === 0) return;
    const handle = window.setInterval(() => {
      const now = Date.now();
      setItems((prev) =>
        prev.filter((it) => {
          if (it.status === 'queued' || it.status === 'running' || it.status === 'awaiting_save') {
            return true;
          }
          const completed = it.completedAt ? Date.parse(it.completedAt) : Date.parse(it.createdAt);
          return now - completed < COMPLETED_TTL_MS;
        }),
      );
    }, 5000);
    return () => window.clearInterval(handle);
  }, [items.length]);

  const value = useMemo<ActiveImportsContextValue>(
    () => ({ items, register, dismiss }),
    [items, register, dismiss],
  );

  return <ActiveImportsContext.Provider value={value}>{children}</ActiveImportsContext.Provider>;
}

export function useActiveImports(): ActiveImportsContextValue {
  const ctx = useContext(ActiveImportsContext);
  if (!ctx) {
    throw new Error('useActiveImports must be used inside ActiveImportsProvider');
  }
  return ctx;
}
