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
  created_at: string;
  completed_at: string | null;
};

type RegisterArgs = {
  jobId: string;
  householdId: string;
  kind: ImportKind;
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

function rowToActive(row: Row, origin: ActiveImport['origin']): ActiveImport {
  return {
    jobId: row.id,
    householdId: row.household_id,
    kind: row.kind,
    status: row.status,
    phase: (row.phase ?? null) as ImportPhase,
    progressText: row.progress_text ?? null,
    recipeId: row.recipe_id ?? null,
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

  const register = useCallback(
    ({ jobId, householdId, kind }: RegisterArgs) => {
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
      // Only notify when the originating tab has navigated away. The
      // synchronous flow on the import page handles its own toast +
      // navigation; this branch covers the background-detach case.
      if (!originated.has(row.id) || window.location.pathname.includes('/import')) {
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
      }
    },
    [navigate, originated, push, queryClient, saved, t],
  );

  // Subscribe once per session per profile. Re-subscribes when the user
  // signs in as a different account.
  useEffect(() => {
    if (!profileId) {
      setItems([]);
      originated.clear();
      saved.clear();
      return;
    }
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
          if (row.status === 'awaiting_save') {
            void saveFromAwaiting(row);
          } else if (row.status === 'needs_review') {
            push({
              variant: 'error',
              title: t('import.needs_review_title'),
              description: t('import.needs_review_body'),
            });
          } else if (row.status === 'failed') {
            // Don't double-toast when the sync error path already notified.
            if (!originated.has(row.id)) {
              push({
                variant: 'error',
                title: t('import.error_title'),
                description: t('errors.internal'),
              });
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, originated, saved, upsert, saveFromAwaiting, push, t]);

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
