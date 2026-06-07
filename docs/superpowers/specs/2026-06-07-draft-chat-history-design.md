# Resumable Draft-Chat History Sidebar — Design Spec

- **Date:** 2026-06-07
- **Status:** Approved design — pending implementation plan
- **Topic:** Browse, resume, rename, and delete past recipe-drafting chat sessions
- **Touches frozen contracts:** None (SPA-only; no schema, no Edge Function changes)

## 1. Overview

The in-app recipe-drafting chat (#84, built on Anthropic **Managed Agents**)
already persists everything needed to return to a conversation later:

- `app.recipe_chat_sessions` and `app.recipe_chat_messages` store the thread,
  the latest draft, and status server-side.
- The Managed Agents session is **stateful on Anthropic's side**, so resuming a
  session and continuing the back-and-forth already works at the data layer.

What's missing is the **UI to get back in**. Today `draft.tsx` holds the active
`chatSessionId` in local React `useState`, so a reload or navigating away loses
the thread even though the row still exists, and there is no list of past chats.
The original spec explicitly cut this as a v1 simplification ("No elaborate
chat-history browser… the UI shows the current draft session only").

This feature adds a **chat-history sidebar** to the draft page: list past
sessions, click to resume one (loading its messages + live draft), start a new
chat, and rename or delete old sessions. It is **entirely client-side** — no
migration and no Edge Function changes.

## 2. Goals & non-goals

**Goals**
- List a household's past draft-chat sessions, newest first.
- Resume any session: selecting it loads its messages and current draft into the
  existing chat + preview panes, and further messages continue the same
  Anthropic session.
- Start a new chat from the sidebar.
- Rename a session's auto-generated title.
- Delete a session (cascades to its messages).
- Keep the list live via Realtime (new sessions appear; titles/status update).
- Reuse existing primitives and design tokens; no new design language.

**Non-goals (YAGNI)**
- No URL/route changes — the page keeps its in-page `chatSessionId` state model
  (per product decision). Sessions are not deep-linkable/shareable in this
  iteration.
- No migration or RLS changes (existing policies already permit member-read and
  editor update/delete).
- No Edge Function changes.
- No cross-household or global "all my chats" view.
- No changes to session archiving or the stale-session reaper.
- No bulk operations.

## 3. Constraints & context

- **SPA-only.** All reads/writes go through the Supabase JS client under the
  user's JWT, governed by existing RLS.
- **RLS already supports this** (`supabase/migrations/20260606120100_recipe_chat.sql`):
  - `recipe_chat_sessions_read` — `for select using (is_household_member(household_id))`.
  - `recipe_chat_sessions_write` — `for all using/with check (is_household_editor(household_id))`,
    which covers `UPDATE` (rename) and `DELETE`.
  - `grant select, insert, update, delete … to authenticated` is already in place.
  - `recipe_chat_messages` rows cascade on session delete (FK `on delete cascade`).
- **Realtime** is already enabled on both tables (added to the
  `supabase_realtime` publication), and there is an index on
  `(household_id, created_at desc)` for the list query.
- **Titles already exist**: `recipe-chat-send/handler.ts` sets
  `title = message.slice(0, 80)` on session creation, so each row has a sensible
  default label.
- Reuse the Realtime + TanStack Query patterns already in
  `src/lib/queries/recipe-chat.ts` and the existing page-level `mobileView`
  toggle pattern in `draft.tsx`.

## 4. Architecture

All changes live in the SPA:

```
src/lib/queries/recipe-chat.ts      (new hooks: list, rename, delete)
src/ui/recipe/chat/ChatHistorySidebar.tsx   (new component + tests)
src/routes/h/$householdId/draft.tsx (wire sidebar + selection)
src/lib/i18n.en.ts (+ sibling locales)      (new chat.* strings)
```

**Selection model (unchanged page state):** the sidebar is a controlled list.
Clicking a row calls `setChatSessionId(row.id)`; the existing
`useChatMessages(chatSessionId)` and `useChatSession(chatSessionId)` hooks then
load and subscribe to that session. "New chat" calls `setChatSessionId(null)`,
resetting to the empty composer. No new global state.

## 5. Data layer (`src/lib/queries/recipe-chat.ts`)

Add three exports, following the file's existing conventions:

- `useChatSessions(householdId: string)` — TanStack Query returning
  `ChatSessionSummary[]`:
  ```ts
  type ChatSessionSummary = {
    id: string;
    title: string | null;
    status: string;
    recipe_id: string | null;
    created_at: string;
    updated_at: string;
  };
  ```
  Query: `select id, title, status, recipe_id, created_at, updated_at`
  `.eq('household_id', householdId).order('created_at', { ascending: false })`.
  Realtime: subscribe to `recipe_chat_sessions` filtered by
  `household_id=eq.<id>` for `*` (INSERT/UPDATE/DELETE) and invalidate the list
  query, mirroring the existing `useChatMessages`/`useChatSession` subscriptions.

- `useRenameChatSession()` — mutation `{ id, title }` →
  `supabase.from('recipe_chat_sessions').update({ title }).eq('id', id)`;
  invalidate `['recipe-chat-sessions', householdId]` and the per-session query.
  Trim input; reject empty (fall back to keeping the old title). Cap length at
  80 chars to match the generated-title convention.

- `useDeleteChatSession()` — mutation `{ id }` →
  `…delete().eq('id', id)`; messages cascade. Invalidate the list.

All three rely on RLS for authorization; no service role, no Edge Function.

## 6. UI: `ChatHistorySidebar.tsx`

Location: `src/ui/recipe/chat/ChatHistorySidebar.tsx` (co-located test).

Props:
```ts
{
  sessions: ChatSessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}
```

Layout:
- Header with a **"New chat"** button (primary, full-width).
- Scrollable list of rows, newest first. Each row shows:
  - **Title** (or a localized "Untitled draft" fallback when null), truncated.
  - A compact **status/saved indicator** — a "Saved" badge when
    `recipe_id != null`, otherwise a subtle dot/label for `running`/`error`
    (reusing existing badge styling; no new tokens).
  - **Relative time** from `updated_at`.
  - Inline **Rename** (pencil) and **Delete** (trash) `IconButton`s revealed on
    row hover/focus. (There is no dropdown/menu primitive in the codebase, so we
    use inline icon buttons rather than a kebab menu.)
- The **active** row is visually highlighted.
- **Rename**: inline edit in place (text input seeded with the current title;
  Enter/blur commits via `onRename`, Esc cancels). Empty → no-op.
- **Delete**: confirmation (existing dialog/confirm primitive); on confirm calls
  `onDelete`. If the deleted session is the active one, the page resets to
  new-chat (handled in `draft.tsx`).
- **Empty state**: friendly localized line ("No drafts yet — start one above").

Mobile: the sidebar is hidden inline and opened as a **drawer/sheet** via a
"History" toggle button, consistent with the page's existing `mobileView`
pattern. Watch for mobile overflow (visual-validation requirement).

Styling reuses Button, the themed menu, dialog/confirm, and badge primitives —
**no new design tokens**.

## 7. Wiring `draft.tsx`

- Add `const sessions = useChatSessions(householdId)` and the rename/delete
  mutations.
- Desktop layout becomes three regions: **history sidebar | chat | preview**
  (e.g. a sidebar column + the existing two-pane grid). Keep `max-w` sensible so
  the chat/preview panes don't get cramped.
- Handlers:
  - `onSelect(id)` → `setChatSessionId(id)` (also closes the mobile drawer).
  - `onNew()` → `setChatSessionId(null)`.
  - `onRename(id, title)` → rename mutation.
  - `onDelete(id)` → delete mutation; in `onSuccess`, if `id === chatSessionId`
    then `setChatSessionId(null)`.
- After the first message of a brand-new chat, `recipe-chat-send` creates the row
  and returns its id (existing behavior); `setChatSessionId(id)` already runs,
  and the new row appears in the sidebar via Realtime.

## 8. i18n

New keys under `chat.*` in `src/lib/i18n.en.ts` and sibling locale files:
`history`, `new_chat`, `rename`, `delete`, `confirm_delete`,
`untitled_draft`, `saved_badge`, `history_empty`, plus the mobile "History"
toggle label. Reuse existing "pantry"/draft vocabulary and tone.

## 9. Error handling & edge cases

- **Non-editor member**: RLS denies update/delete. The UI hides or disables
  rename/delete for users who lack editor rights (the page is already gated to
  editors per the original spec's assumption, but guard defensively); a failed
  mutation surfaces an error toast and refetches.
- **Delete the active session**: reset to new-chat (`chatSessionId = null`).
- **Realtime drop**: list refetches on reconnect / query refocus (TanStack
  Query default), matching the existing message/session hooks.
- **Empty title after rename**: no-op, keep the previous title.
- **Concurrent rename/delete from another device**: INSERT and UPDATE events
  carry the full row (incl. `household_id`), so new sessions and title/status
  changes propagate live to other clients. **DELETE does not propagate live to
  other clients**: with the table's default replica identity (primary key only),
  Realtime DELETE events carry only `id`, so the `household_id` channel filter
  can't match them. The acting client updates immediately (its mutation
  invalidates the list directly); other open clients drop the row on the next
  refetch/refocus. Making cross-device deletes instant would require
  `replica identity full` (a migration), which is intentionally out of the
  SPA-only scope of this iteration.

## 10. Testing strategy

- **Component tests** (`pnpm test:components`, co-located): list render with
  multiple sessions and active highlight; select fires `onSelect`; "New chat"
  fires `onNew`; rename flow (inline edit → commit/cancel/empty); delete flow
  (confirm → `onDelete`); empty state; "Saved" badge when `recipe_id` set.
- **DB/RLS** (`pnpm test:db`): add focused cases that an **editor** can
  `UPDATE` (rename) and `DELETE` a session while a **stranger (non-member)**
  cannot — since the client now exercises these paths directly. (Read access is
  already covered. Note: `household_members.role` is constrained to
  `('owner','editor')`, so every member is an editor; there is no non-editor
  member role to test, and the sidebar does not gate actions by role.)
- **Playwright visual validation** (required by CLAUDE.md,
  `validating-features-visually`): signup → create two drafts → switch between
  them via the sidebar → rename one → delete one → start a new chat, at desktop
  and mobile viewports; screenshot each step and check the adjacent draft flow
  for regressions.
- `pnpm typecheck && pnpm lint` after the changes.

## 11. Open questions / assumptions

- **Assumption:** draft-chat access remains gated to household **editors** (per
  the original recipe-drafting spec). The sidebar still defensively hides
  rename/delete for non-editors.
- **Assumption:** the auto-generated title (first 80 chars of the opening
  message) is an acceptable default label; rename exists for when it isn't.
- **Known v1 limitations (acceptable, documented):** cross-device DELETE is not
  live (see §9); the mobile history `Drawer` overlay is gated to mobile via the
  `md:hidden` toggle, so the rare "open on mobile, then resize to desktop" case
  could briefly show an overlay until closed.
- **Future (not in scope):** deep-linkable session URLs / sharing; a global
  cross-household chat list; bulk delete; search/filter over past drafts;
  `replica identity full` for instant cross-device deletes.
