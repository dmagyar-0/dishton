# Resumable Draft-Chat History Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat-history sidebar to the recipe-drafting page so users can browse, resume, rename, and delete their household's past draft-chat sessions.

**Architecture:** SPA-only. The data (`app.recipe_chat_sessions` / `recipe_chat_messages`) and the stateful Anthropic Managed Agents session already persist; existing RLS already permits member-read and editor update/delete; Realtime is already enabled on both tables. We add three TanStack-Query hooks, one presentational sidebar component (+ a mobile drawer), wire them into the existing in-page `chatSessionId` state in `draft.tsx`, add i18n strings, and extend the existing RLS test. No migration, no Edge Function changes.

**Tech Stack:** React + Vite, TanStack Query, Supabase JS (schema `app`), Radix-based primitives (`Dialog`, `Drawer`, `Button`, `IconButton`, `Input`, `Badge`), lucide-react icons, Vitest + Testing Library (components), Deno + pgTAP-style SQL (RLS), Playwright (visual validation), Biome.

**Key facts verified against the codebase:**
- `src/lib/supabase.ts` sets `db: { schema: 'app' }`, so `.from('recipe_chat_sessions')` resolves to `app.recipe_chat_sessions`. Realtime subscriptions pass `schema: 'app'` explicitly (see existing hooks).
- `recipe_chat_sessions` is in the `supabase_realtime` publication and has index `(household_id, created_at desc)`.
- RLS `recipe_chat_sessions_write` is `for all using/with check (app.is_household_editor(household_id))` — covers UPDATE (rename) and DELETE. Messages cascade on session delete.
- `household_members.role` is constrained to `('owner','editor')`; `is_household_member` matches any membership. **Every member is therefore an editor** — there is no "viewer" role to test, so the RLS test exercises editor-can vs stranger-cannot (not "non-editor member"). The sidebar does not gate rename/delete by role (YAGNI: no non-editor members exist).
- There is **no dropdown/menu primitive**; row actions use inline `IconButton`s (pencil / trash). Confirmation uses the existing `Dialog`.
- `cn` (`src/ui/cn.ts`) is `twMerge(clsx(...))`, so `h-8 w-8` overrides `IconButton`'s default `h-10 w-10`.

---

## File structure

- **Modify** `src/lib/i18n.en.ts` and `src/lib/i18n.de.ts` — new `chat.*` keys.
- **Modify** `src/lib/queries/recipe-chat.ts` — add `ChatSessionSummary` type and `useChatSessions`, `useRenameChatSession`, `useDeleteChatSession` hooks.
- **Create** `src/ui/recipe/chat/ChatHistorySidebar.tsx` — presentational list (props in, callbacks out).
- **Create** `src/ui/recipe/chat/ChatHistorySidebar.test.tsx` — component tests.
- **Modify** `src/routes/h/$householdId/draft.tsx` — render the sidebar (desktop column + mobile drawer) and wire handlers to the existing `chatSessionId` state.
- **Modify** `supabase/tests/recipe_chat.test.sql` — add editor-can / stranger-cannot rename + delete checks.

---

## Task 1: i18n strings

**Files:**
- Modify: `src/lib/i18n.en.ts:6-19` (the `chat` block)
- Modify: `src/lib/i18n.de.ts:6-19` (the `chat` block)

- [ ] **Step 1: Add English keys**

In `src/lib/i18n.en.ts`, replace the closing of the `chat` block (the lines for `view_draft` / `view_chat`) so the block ends like this:

```ts
    view_draft: 'View draft',
    view_chat: 'Back to chat',
    history: 'Your drafts',
    new_chat: 'New chat',
    history_empty: 'No drafts yet — start one above.',
    untitled_draft: 'Untitled draft',
    saved_badge: 'Saved',
    rename: 'Rename',
    save_rename: 'Save name',
    delete: 'Delete',
    delete_title: 'Delete this draft?',
    delete_confirm_body: 'This removes the chat and its messages. This cannot be undone.',
    confirm_delete: 'Delete',
    cancel: 'Cancel',
  },
```

- [ ] **Step 2: Add German keys**

In `src/lib/i18n.de.ts`, mirror the same keys at the end of the `chat` block:

```ts
    view_draft: 'Entwurf ansehen',
    view_chat: 'Zurück zum Chat',
    history: 'Deine Entwürfe',
    new_chat: 'Neuer Chat',
    history_empty: 'Noch keine Entwürfe — starte oben einen.',
    untitled_draft: 'Unbenannter Entwurf',
    saved_badge: 'Gespeichert',
    rename: 'Umbenennen',
    save_rename: 'Namen speichern',
    delete: 'Löschen',
    delete_title: 'Diesen Entwurf löschen?',
    delete_confirm_body: 'Damit werden der Chat und seine Nachrichten entfernt. Das kann nicht rückgängig gemacht werden.',
    confirm_delete: 'Löschen',
    cancel: 'Abbrechen',
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the two locale objects must stay structurally identical; if `i18n.ts` enforces a key type from `en`, `de` now matches).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "i18n: strings for draft-chat history sidebar"
```

---

## Task 2: Data-layer hooks

**Files:**
- Modify: `src/lib/queries/recipe-chat.ts` (append after the existing exports)

These hooks talk to Supabase under the user's JWT; like the existing hooks in this file they have no isolated unit test (mocking the Supabase client is not done in this repo). They are covered by the component wiring, the RLS test (Task 5), and Playwright (Task 6). Typecheck is the gate here.

- [ ] **Step 1: Add the summary type and list hook**

Append to `src/lib/queries/recipe-chat.ts`:

```ts
export type ChatSessionSummary = {
  id: string;
  title: string | null;
  status: string;
  recipe_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useChatSessions(householdId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-sessions', householdId],
    queryFn: async (): Promise<ChatSessionSummary[]> => {
      const { data, error } = await supabase
        .from('recipe_chat_sessions')
        .select('id, title, status, recipe_id, created_at, updated_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChatSessionSummary[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`recipe_chat_sessions:household:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'app',
          table: 'recipe_chat_sessions',
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', householdId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, qc]);

  return query;
}
```

- [ ] **Step 2: Add the rename and delete mutations**

Append to the same file:

```ts
export function useRenameChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; id: string; title: string }): Promise<void> => {
      const { error } = await supabase
        .from('recipe_chat_sessions')
        .update({ title: args.title })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', vars.householdId] });
      void qc.invalidateQueries({ queryKey: ['recipe-chat-session', vars.id] });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; id: string }): Promise<void> => {
      const { error } = await supabase
        .from('recipe_chat_sessions')
        .delete()
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['recipe-chat-sessions', vars.householdId] });
    },
  });
}
```

(`useQuery`, `useMutation`, `useQueryClient`, `useEffect`, and `supabase` are already imported at the top of the file.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/recipe-chat.ts
git commit -m "feat(recipe-chat): list/rename/delete session hooks"
```

---

## Task 3: ChatHistorySidebar component (TDD)

**Files:**
- Create: `src/ui/recipe/chat/ChatHistorySidebar.tsx`
- Test: `src/ui/recipe/chat/ChatHistorySidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/recipe/chat/ChatHistorySidebar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import type { ChatSessionSummary } from '@/lib/queries/recipe-chat';
import { ChatHistorySidebar } from './ChatHistorySidebar';

const base: ChatSessionSummary = {
  id: 's1',
  title: 'Cozy autumn soup',
  status: 'idle',
  recipe_id: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

function noop() {}

describe('ChatHistorySidebar', () => {
  it('renders a row per session and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base, { ...base, id: 's2', title: 'Spicy ramen' }]}
        activeId={null}
        onSelect={onSelect}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Spicy ramen' }));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('shows the untitled fallback when title is null', () => {
    render(
      <ChatHistorySidebar
        sessions={[{ ...base, title: null }]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.untitled_draft')).toBeInTheDocument();
  });

  it('shows a saved badge when the session produced a recipe', () => {
    render(
      <ChatHistorySidebar
        sessions={[{ ...base, recipe_id: 'r1' }]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.saved_badge')).toBeInTheDocument();
  });

  it('marks the active row with aria-current', () => {
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId="s1"
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cozy autumn soup' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('fires onNew from the New chat button', () => {
    const onNew = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[]}
        activeId={null}
        onSelect={noop}
        onNew={onNew}
        onRename={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'chat.new_chat' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('shows the empty state when there are no sessions', () => {
    render(
      <ChatHistorySidebar
        sessions={[]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('chat.history_empty')).toBeInTheDocument();
  });

  it('renames via inline edit on Enter', () => {
    const onRename = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={onRename}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.rename'));
    const input = screen.getByLabelText('chat.rename');
    fireEvent.change(input, { target: { value: 'Harvest soup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('s1', 'Harvest soup');
  });

  it('deletes after confirming in the dialog', () => {
    const onDelete = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[base]}
        activeId={null}
        onSelect={noop}
        onNew={noop}
        onRename={noop}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText('chat.delete'));
    fireEvent.click(screen.getByRole('button', { name: 'chat.confirm_delete' }));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/ui/recipe/chat/ChatHistorySidebar.test.tsx`
Expected: FAIL — cannot resolve `./ChatHistorySidebar`.

- [ ] **Step 3: Implement the component**

Create `src/ui/recipe/chat/ChatHistorySidebar.tsx`:

```tsx
import type { ChatSessionSummary } from '@/lib/queries/recipe-chat';
import { cn } from '@/ui/cn';
import { Badge } from '@/ui/primitives/Badge';
import { Button } from '@/ui/primitives/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/Dialog';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

export function ChatHistorySidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startEdit = (s: ChatSessionSummary) => {
    setEditingId(s.id);
    setDraftTitle(s.title ?? '');
  };

  const commitEdit = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(id, trimmed.slice(0, 80));
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Plus size={16} aria-hidden="true" />}
        onClick={onNew}
      >
        {t('chat.new_chat')}
      </Button>

      {sessions.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">{t('chat.history_empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            if (editingId === s.id) {
              return (
                <li key={s.id} className="flex items-center gap-1 px-1">
                  <Input
                    aria-label={t('chat.rename')}
                    value={draftTitle}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => commitEdit(s.id)}
                  />
                  <IconButton
                    label={t('chat.save_rename')}
                    className="h-8 w-8"
                    icon={<Check size={16} />}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitEdit(s.id)}
                  />
                </li>
              );
            }
            return (
              <li
                key={s.id}
                className={cn(
                  'group flex items-center gap-1 rounded-[var(--radius-md)] px-1',
                  isActive && 'bg-paper-2',
                )}
              >
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(s.id)}
                  className="min-w-0 flex-1 px-1 py-2 text-left"
                >
                  <span className="block truncate text-sm text-ink">
                    {s.title?.trim() || t('chat.untitled_draft')}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    {s.recipe_id && <Badge variant="secondary">{t('chat.saved_badge')}</Badge>}
                    <time className="text-xs text-ink-muted" dateTime={s.updated_at}>
                      {new Date(s.updated_at).toLocaleDateString()}
                    </time>
                  </span>
                </button>
                <IconButton
                  label={t('chat.rename')}
                  className="h-8 w-8 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  icon={<Pencil size={16} />}
                  onClick={() => startEdit(s)}
                />
                <IconButton
                  label={t('chat.delete')}
                  className="h-8 w-8 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  icon={<Trash2 size={16} />}
                  onClick={() => setDeletingId(s.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chat.delete_title')}</DialogTitle>
            <DialogDescription>{t('chat.delete_confirm_body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletingId(null)}>
              {t('chat.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingId) onDelete(deletingId);
                setDeletingId(null);
              }}
            >
              {t('chat.confirm_delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/ui/recipe/chat/ChatHistorySidebar.test.tsx`
Expected: PASS (8 tests). If the rename test sees two elements for `chat.rename`, confirm the editing branch replaces the row (the non-edit IconButtons must not render while editing) — the code above already does this.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/recipe/chat/ChatHistorySidebar.tsx src/ui/recipe/chat/ChatHistorySidebar.test.tsx
git commit -m "feat(recipe-chat): chat-history sidebar component"
```

---

## Task 4: Wire the sidebar into the draft page

**Files:**
- Modify: `src/routes/h/$householdId/draft.tsx`

- [ ] **Step 1: Update imports**

Replace the import block at the top of `src/routes/h/$householdId/draft.tsx` (lines 1-16) so it also pulls in the new hooks, the sidebar, and the Drawer primitives:

```tsx
import {
  useChatMessages,
  useChatSession,
  useChatSessions,
  useDeleteChatSession,
  useRenameChatSession,
  useSaveDraft,
  useSendChatMessage,
} from '@/lib/queries/recipe-chat';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/Button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/primitives/Drawer';
import { useToast } from '@/ui/primitives/Toast';
import { DraftPreviewCard } from '@/ui/recipe/DraftPreviewCard';
import { ChatComposer } from '@/ui/recipe/chat/ChatComposer';
import { ChatHistorySidebar } from '@/ui/recipe/chat/ChatHistorySidebar';
import { ChatThread } from '@/ui/recipe/chat/ChatThread';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';
```

- [ ] **Step 2: Add state, hooks, and handlers**

Inside `DraftPage`, after the existing `const [mobileView, setMobileView] = useState<'chat' | 'draft'>('chat');` line, add:

```tsx
  const [historyOpen, setHistoryOpen] = useState(false);

  const sessions = useChatSessions(householdId);
  const rename = useRenameChatSession();
  const del = useDeleteChatSession();

  const openSession = (id: string) => {
    setChatSessionId(id);
    setHistoryOpen(false);
    setMobileView('chat');
  };
  const newChat = () => {
    setChatSessionId(null);
    setHistoryOpen(false);
    setMobileView('chat');
  };
  const onRename = (id: string, title: string) => rename.mutate({ householdId, id, title });
  const onDelete = (id: string) =>
    del.mutate(
      { householdId, id },
      {
        onSuccess: () => {
          if (id === chatSessionId) setChatSessionId(null);
        },
        onError: () => push({ variant: 'error', title: t('chat.save_error') }),
      },
    );
```

- [ ] **Step 3: Render the sidebar (desktop column + mobile drawer)**

Replace the page body — the `return (...)` JSX (currently lines 63-105, the `<main>...</main>` block) — with:

```tsx
  const sidebar = (
    <ChatHistorySidebar
      sessions={sessions.data ?? []}
      activeId={chatSessionId}
      onSelect={openSession}
      onNew={newChat}
      onRename={onRename}
      onDelete={onDelete}
    />
  );

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="font-display text-display mb-4">{t('chat.title')}</h1>

      <div className="md:hidden mb-3 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          {t('chat.history')}
        </Button>
        <Button
          variant={mobileView === 'chat' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMobileView('chat')}
        >
          {t('chat.view_chat')}
        </Button>
        <Button
          variant={mobileView === 'draft' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMobileView('draft')}
        >
          {t('chat.view_draft')}
        </Button>
      </div>

      <div className="md:flex md:gap-6">
        <aside className="hidden md:block md:w-64 md:shrink-0">{sidebar}</aside>

        <div className="flex-1 grid md:grid-cols-2 gap-6">
          <div
            className={cn('flex-col gap-4', mobileView === 'chat' ? 'flex' : 'hidden', 'md:flex')}
          >
            <div className="min-h-[40vh]">
              <ChatThread messages={messages.data ?? []} thinking={thinking} />
            </div>
            <ChatComposer onSend={onSend} disabled={send.isPending} />
          </div>

          <div className={cn(mobileView === 'draft' ? 'block' : 'hidden', 'md:block')}>
            <h2 className="font-display text-xl mb-2">{t('chat.draft_heading')}</h2>
            {draft ? (
              <DraftPreviewCard draft={draft} />
            ) : (
              <p className="text-ink-soft">{t('chat.no_draft_yet')}</p>
            )}
            <Button className="mt-6 w-full" disabled={!draft || save.isPending} onClick={onSave}>
              {t('chat.save')}
            </Button>
          </div>
        </div>
      </div>

      <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
        <DrawerContent side="bottom" className="md:hidden">
          <DrawerHeader>
            <DrawerTitle>{t('chat.history')}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto">{sidebar}</div>
        </DrawerContent>
      </Drawer>
    </main>
  );
```

(`push`, `t`, `chatSessionId`, `setChatSessionId`, `messages`, `thinking`, `draft`, `send`, `save`, `onSend`, `onSave` are all already defined earlier in the component and remain unchanged.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/h/$householdId/draft.tsx
git commit -m "feat(recipe-chat): wire history sidebar into draft page"
```

---

## Task 5: RLS test for rename + delete

**Files:**
- Modify: `supabase/tests/recipe_chat.test.sql`

- [ ] **Step 1: Seed a second session for the delete test**

In `supabase/tests/recipe_chat.test.sql`, immediately after the existing seed insert for session `...0001` (around line 47), add a second session that the delete checks can consume without affecting the read checks on `...0001`:

```sql
insert into app.recipe_chat_sessions (id, household_id, created_by, anthropic_session_id)
values ('22222222-0000-0000-0000-000000000002',
        '11111111-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000e1','sesn_test_2')
on conflict (id) do nothing;
```

- [ ] **Step 2: Add update/delete persona helpers**

After the existing `pg_temp.q_insert_message` function definition (after line 87), add:

```sql
-- Attempt to rename a session under the persona; RLS denial yields 0 rows.
create or replace function pg_temp.q_update_title(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    update app.recipe_chat_sessions set title = 'renamed' where id = p_session;
    get diagnostics n = row_count;
  exception when others then n := 0;
  end;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- Attempt to delete a session under the persona; RLS denial yields 0 rows.
create or replace function pg_temp.q_delete(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    delete from app.recipe_chat_sessions where id = p_session;
    get diagnostics n = row_count;
  exception when others then n := 0;
  end;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;
```

- [ ] **Step 3: Add the assertions**

Immediately before the final `select label, ok from _t_results order by label;` line, add:

```sql
select pg_temp.check_as('stranger cannot rename session',
  pg_temp.q_update_title('00000000-0000-0000-0000-0000000000f1'::uuid,
                         '22222222-0000-0000-0000-000000000001'::uuid) = 0);

select pg_temp.check_as('editor can rename session',
  pg_temp.q_update_title('00000000-0000-0000-0000-0000000000e1'::uuid,
                         '22222222-0000-0000-0000-000000000001'::uuid) = 1);

select pg_temp.check_as('stranger cannot delete session',
  pg_temp.q_delete('00000000-0000-0000-0000-0000000000f1'::uuid,
                   '22222222-0000-0000-0000-000000000002'::uuid) = 0);

select pg_temp.check_as('editor can delete session',
  pg_temp.q_delete('00000000-0000-0000-0000-0000000000e1'::uuid,
                   '22222222-0000-0000-0000-000000000002'::uuid) = 1);
```

(The editor delete targets session `...0002`, leaving `...0001` intact for the existing read/insert checks. The transaction is rolled back by the runner, so seeds vanish afterward.)

- [ ] **Step 4: Run the DB tests**

Run: `pnpm test:db`
Expected: PASS — all labels (including the four new ones) report `ok = t`. Requires `supabase start` running locally.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/recipe_chat.test.sql
git commit -m "test(db): rename/delete RLS for recipe-chat sessions"
```

---

## Task 6: Verification + visual validation

**Files:** none (verification only)

- [ ] **Step 1: Full static checks + component suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:components`
Expected: all PASS (the new sidebar tests run as part of `src/ui`).

- [ ] **Step 2: Visual validation (required by CLAUDE.md)**

Invoke the `validating-features-visually` skill. Drive Playwright through, at desktop **and** mobile viewports, capturing a screenshot at each step:
1. Sign up / sign in and open a household.
2. Go to **Draft with AI**; send a vibe to create draft #1.
3. New chat; create draft #2.
4. Open the history sidebar (desktop column; mobile via the **History** drawer) and confirm both sessions appear, newest first, with the active row highlighted.
5. Click draft #1 — confirm its messages and preview load (resume works).
6. Rename draft #1 inline; confirm the new title shows in the list.
7. Delete draft #2 via the confirm dialog; confirm it disappears and, if it was open, the page resets to a new chat.
8. Check the adjacent send/save flow still works and watch for mobile overflow.

Expected: no flash-of-wrong-content, no mobile overflow, list stays in sync.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin claude/persistent-agent-sessions-EV608
```

Retry on network failure with exponential backoff (2s, 4s, 8s, 16s).

---

## Self-review

**Spec coverage:**
- List past sessions (newest first, live) → Task 2 (`useChatSessions` + realtime) + Task 3/4 render. ✓
- Resume a session (load messages + draft) → Task 4 `openSession` sets existing `chatSessionId`; existing hooks react. ✓
- New chat → Task 3 button + Task 4 `newChat`. ✓
- Rename → Task 2 `useRenameChatSession`, Task 3 inline edit, Task 4 wiring. ✓
- Delete (cascade) → Task 2 `useDeleteChatSession`, Task 3 confirm dialog, Task 4 wiring + active reset. ✓
- Saved badge / status indicator → Task 3 badge on `recipe_id`. ✓
- Mobile drawer → Task 4 Drawer. ✓
- i18n en+de → Task 1. ✓
- Component tests → Task 3; DB/RLS → Task 5; visual → Task 6. ✓
- No migration / no Edge Function changes → confirmed; none in any task. ✓

**Spec deviations (intentional, noted above):**
- RLS test is editor-can vs stranger-cannot (not "non-editor member"): no non-editor member role exists in the schema. The sidebar likewise does not gate actions by role.
- Row actions are inline `IconButton`s, not a kebab menu: no dropdown primitive exists.

**Placeholder scan:** none — every code/step is concrete.

**Type/name consistency:** `ChatSessionSummary` defined in Task 2, imported in Tasks 3 & 4; hooks `useChatSessions` / `useRenameChatSession` / `useDeleteChatSession` named identically across Tasks 2 & 4; mutation arg shapes (`{ householdId, id, title }`, `{ householdId, id }`) match between hook definitions and call sites; i18n keys used in Task 3 all defined in Task 1.
