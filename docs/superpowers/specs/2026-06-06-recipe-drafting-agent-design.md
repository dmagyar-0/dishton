# Recipe-Drafting Agent (Managed Agents) — Design Spec

- **Date:** 2026-06-06
- **Status:** Approved design — pending implementation plan
- **Topic:** In-app conversational recipe-drafting agent built on Anthropic Managed Agents
- **Touches frozen contracts:** Recipe Zod schema (`src/domain/recipe.ts`), SQL schema (new migrations), design tokens (reuse only)

## 1. Overview

A new in-app feature where a user describes the recipe they want — a "vibe" plus optional ingredients — and chats with an agent that:

1. Reads the household's existing recipes to learn its taste.
2. Searches the web for technique/ratios/inspiration.
3. Produces a complete draft recipe, shown as a live preview card.
4. Iterates on the user's feedback.
5. On an explicit **"Save to pantry"** click, writes the recipe into Dishton via the existing `save_recipe` RPC.

It is built on **Anthropic Managed Agents** (Anthropic runs the agent loop in a hosted session; we supply config + custom tools). A secondary goal is to get familiar with the Managed Agents platform.

## 2. Goals & non-goals

**Goals**
- Conversational, multi-turn recipe drafting inside the Dishton SPA.
- Taste-awareness from the household's existing recipes.
- Web-informed drafting.
- Drafts that always conform to the frozen `Recipe` Zod schema.
- Human-in-the-loop save (explicit button, user's security context).
- Stay within the free tier — minimal new infra, reuse existing edge-function stack.

**Non-goals (v1 cuts — YAGNI)**
- No cross-session memory store (taste is re-learned each session).
- No hero-image generation.
- No multi-agent / sub-agents.
- No token-by-token streaming (per-turn updates via Realtime are sufficient).
- No in-card draft editing (refine via chat only).
- No elaborate chat-history browser (sessions persist server-side, so resume works, but the UI shows the current draft session only).
- Full stale-session reaper is a follow-up; v1 only archives the Anthropic session on Save.

## 3. Constraints & context

- **In-app feature**, not a CLI tool.
- **Server glue runs in Supabase Edge Functions** (Deno). Free tier.
- Because the Managed Agents **session is stateful on Anthropic's side** and we use a **webhook-driven** model (Approach 2), no edge function holds a long-lived connection, which sidesteps the edge-function wall-clock limit. Web searches can take as long as needed.
- The draft must conform to the **frozen `Recipe` schema** (`src/domain/recipe.ts`): `RecipeMeta` (title, description, source_type, source_url, source_language, canonical_unit_system, servings, total_time_min, hero_image_path, tags[]) + `ingredients[]` + `steps[]`.
- Reuse the existing write path **`app.save_recipe(p_household uuid, p_draft jsonb) RETURNS uuid`** (SECURITY DEFINER; checks `auth.uid()` + household membership), the same RPC the import flow uses.
- Reuse `_shared/auth.ts` `resolveCaller`, `_shared/domain` (symlinked schema), and the validate/normalize helpers in `_shared/ai/validate.ts`.
- Reuse the Supabase **Realtime** pattern already used by `ActiveImportsProvider`.

## 4. Architecture

**Components**
- **SPA chat panel** — chat thread + live recipe preview card + "Save to pantry" button. Live updates via Supabase Realtime.
- **Anthropic Managed Agent** — created once (control plane); runs the loop, web search, and decides when to call our custom tools.
- **3 edge functions** — `recipe-chat-send`, `recipe-chat-webhook`, `recipe-chat-save`.
- **2 new tables** — `app.recipe_chat_sessions`, `app.recipe_chat_messages`.

**Data flow (one interaction)**

```
1. User types vibe+ingredients → SPA → [recipe-chat-send] (user JWT)
     → reserve AI budget
     → create Anthropic session (refs RECIPE_AGENT_ID + RECIPE_ENV_ID) if new
     → insert recipe_chat_sessions {anthropic_session_id, household_id, created_by, cursor}
     → insert recipe_chat_messages {role:'user', content} (shows instantly via Realtime)
     → events.send(user.message); return { chat_session_id } fast (no draining)

2. Anthropic runs the turn. When it pauses for one of our tools, the session
   idles → Anthropic POSTs a webhook → [recipe-chat-webhook]:
     → verify HMAC (client.beta.webhooks.unwrap), map data.id → our session row
     → on session.status_run_started: status = 'running' (typing indicator)
     → on session.status_idled: events.list since events_cursor; for each new event:
         • agent.custom_tool_use:
             - list_my_recipes / get_recipe → service-role query scoped to the
               stored household_id → return compact taste summary / full recipe
             - present_draft(recipe) → validate vs Recipe Zod (+1 repair turn);
               store current_draft; insert agent message
             → events.send(user.custom_tool_result)
         • agent.message → insert recipe_chat_messages {role:'agent'}
       advance events_cursor; status = 'idle'
     → on session.status_terminated: status = 'error'
   (web_search runs server-side on Anthropic — no tool round-trip to us)

3. SPA (subscribed via Realtime to recipe_chat_messages + the session row)
   renders new agent messages and updates the preview card live.

4. User refines by chatting → back to step 1 (same session).

5. User clicks "Save to pantry" → SPA → [recipe-chat-save] (user JWT)
     → read current_draft → save_recipe(household_id, current_draft) RPC
     → archive Anthropic session; status = 'saved'; return { recipe_id }
     → SPA navigates to the saved recipe ("It's in your pantry now.")
```

**Auth split (key security property)**
- **Reads during chat** run inside the *webhook* (no user JWT present), so they use the **service-role key strictly filtered by the `household_id`** recorded at send-time. That household binding is authorized at send-time via the user's JWT + membership check.
- **The write** (`save_recipe`) runs in the *Save* function under the **user's JWT**, so RLS governs it and `auth.uid()` is real. The actual data write stays behind an explicit human click in the user's own security context.
- The agent never holds DB credentials; the session container has no internet (`networking: limited`).

## 5. Anthropic agent configuration

Created once via a setup script / `ant` YAML (control plane). IDs stored as Supabase secrets.

**Agent** (`name: "Dishton Recipe Drafter"`)
- **Model:** `claude-sonnet-4-6`, adaptive thinking on, `effort: medium`. (Opus is a one-field upgrade if quality demands it.)
- **System prompt** encodes the workflow: understand vibe + ingredients (ask brief clarifiers only when genuinely ambiguous) → call `list_my_recipes` early to learn taste → use web search sparingly → emit a complete, schema-valid draft via `present_draft` → iterate on feedback → **never save** (the human clicks Save). House rules: match the household's prevailing unit system and language; keep searches few (cost); `source_type: 'manual'`.
- **Tools:**
  - Built-in `agent_toolset_20260401` with **only `web_search` (+ `web_fetch`) enabled**; bash/read/write/edit/glob/grep disabled (no container filesystem work).
  - **3 custom tools** (executed by the webhook): `list_my_recipes`, `get_recipe`, `present_draft`.
- **No MCP servers, skills, memory store, or multiagent** in v1.

**Environment**
- `config.type: "cloud"`, `networking: limited` (deny-by-default egress; web search runs on Anthropic's side, custom tools resolve via webhook, so the container needs no internet).

**Custom tool schemas**

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `list_my_recipes` | `{ limit?, query? }` | compact list `{id, title, tags[], key_ingredients[], unit_system, language}` + an aggregate prefs line | Taste-learning; omits full steps to keep tokens low |
| `get_recipe` | `{ recipe_id }` | full `Recipe` | Optional drill-down |
| `present_draft` | full `Recipe` JSON (hardcoded input_schema, mirroring the existing `extract_recipe` tool) | `{ ok: true }` or `{ ok: false, errors }` | Validates vs the `Recipe` Zod schema; on failure the agent repairs (bounded) |

## 6. Edge functions

1. **`recipe-chat-send`** (user JWT) — `{ chat_session_id?, message, household_id }`.
   - `resolveCaller`; verify household membership (editor).
   - If no session: reserve AI budget; create the Anthropic session referencing `RECIPE_AGENT_ID` + `RECIPE_ENV_ID`; insert the `recipe_chat_sessions` row.
   - Insert the user message row; `events.send(user.message)`. Return `{ chat_session_id }`. Fast — no draining.

2. **`recipe-chat-webhook`** (public; Anthropic → us) — verify HMAC with `client.beta.webhooks.unwrap()`; map `data.id` → our row (ignore if unknown).
   - `session.status_run_started` → `status = running`.
   - `session.status_idled` → `events.list` since `events_cursor`; resolve pending `agent.custom_tool_use` events (list_my_recipes / get_recipe via service-role query filtered by `household_id`; present_draft via Zod validate → store `current_draft`, insert agent message, bounded repair on failure); insert any `agent.message` rows; advance `events_cursor`; `status = idle`.
   - `session.status_terminated` → `status = error` + an agent message.
   - **Idempotency:** dedupe on webhook `event.id` and only act on events past `events_cursor`.

3. **`recipe-chat-save`** (user JWT) — `{ chat_session_id }`.
   - Load the row (RLS-scoped), read `current_draft` (error if null).
   - Call `save_recipe(household_id, current_draft)` **as the user** (real `auth.uid()`).
   - Archive the Anthropic session; `status = saved`; return `{ recipe_id }`.

**New secrets:** `ANTHROPIC_WEBHOOK_SIGNING_KEY`, `RECIPE_AGENT_ID`, `RECIPE_ENV_ID` (`ANTHROPIC_API_KEY` already exists). Webhook URL registered once in the Anthropic Console. Local dev: deploy the webhook to the hosted project or expose it via a tunnel (webhooks can't reach `localhost`).

## 7. Data model (new migrations)

Additive migrations in `supabase/migrations/`, following the existing `app` schema and the `is_household_member` / `is_household_editor` RLS helpers.

**`app.recipe_chat_sessions`**
- `id uuid PK`, `household_id uuid → households ON DELETE CASCADE`, `created_by uuid → profiles`
- `anthropic_session_id text NOT NULL UNIQUE`
- `status text NOT NULL DEFAULT 'running'` (`running` | `idle` | `saved` | `error` | `terminated`)
- `current_draft jsonb` (latest schema-valid draft; null until first `present_draft`)
- `events_cursor text`, `title text`, `created_at timestamptz`, `updated_at timestamptz`
- **RLS:** household **members read** their own household's rows; **insert** restricted to household **editors** (the send fn, user JWT). Webhook updates via service role (bypasses RLS). Indexes on `household_id` and unique `anthropic_session_id`.

**`app.recipe_chat_messages`**
- `id uuid PK`, `chat_session_id uuid → recipe_chat_sessions ON DELETE CASCADE`
- `role text NOT NULL CHECK (role IN ('user','agent'))`, `content text NOT NULL`, `created_at timestamptz`
- **RLS:** members read messages for visible sessions; user msgs inserted by the send fn (user JWT), agent msgs by the webhook (service role).
- **Added to the `supabase_realtime` publication** so the SPA subscribes (same as imports).

## 8. SPA UI

- **Entry point:** a "Draft with AI" action on the pantry/recipe-list page, alongside "Import". New route, e.g. `src/routes/h/$householdId/draft.tsx`.
- **Desktop:** two panes — chat thread (messages + input + "typing…" indicator) and a live recipe preview card rendering `current_draft`.
- **Mobile:** stacked with a toggle (chat primary; "View draft" tab/sheet). Watch for mobile overflow (visual-validation requirement).
- **Preview card** reuses the existing recipe-detail display components; no new design language (frozen tokens / Radix primitives).
- **"Save to pantry" button:** disabled until a valid `current_draft` exists; calls `recipe-chat-save`; on success toast ("It's in your pantry now.") and navigate to the new recipe.
- **Data layer:** `useRecipeChat(chatSessionId)` — TanStack Query for initial load; Supabase Realtime subscriptions to `recipe_chat_messages` (inserts) and the `recipe_chat_sessions` row (updates → `current_draft` + `status`), mirroring `ActiveImportsProvider`. `sendMessage()` → `recipe-chat-send`; `save()` → `recipe-chat-save`.
- **i18n:** new strings in `i18n.en.ts` (+ sibling locales), reusing "pantry" vocabulary.

## 9. Schema validation & repair

- Webhook validates `present_draft` input with `Recipe.safeParse` (from `_shared/domain`) + `normalizePositions` (reindex ingredients/steps to 0-based contiguous), reusing `_shared/ai/validate.ts`.
- Invalid → return `{ ok: false, errors }` (compact Zod issues) as the tool result; the agent repairs and re-calls `present_draft`. **Cap ~2 repair attempts** per draft; if still failing, post an agent message asking the user to adjust.
- The `present_draft` input_schema is hardcoded (mirroring the existing `extract_recipe` tool) for model reliability; the Zod schema is the source of truth for acceptance.
- Force `source_type: 'manual'`, `hero_image_path: null`.

## 10. Cost guardrails (free tier)

- Reuse `app_reserve_ai_budget` — reserve per turn in `recipe-chat-send`; over budget → polite refusal.
- Model Sonnet 4.6 + `effort: medium`; system prompt keeps web searches few; `list_my_recipes` payload stays compact.
- Archive the Anthropic session on Save. (Stale-session reaper, akin to `reap_stuck_imports`, is a follow-up.)

## 11. Error handling & edge cases

- Bad HMAC → 400 ignore. Webhook for unknown session → 200 ignore.
- Session terminated/error → `status = error` + an agent message ("something went wrong, start a new draft"); shown in UI.
- `save_recipe` failure → error toast. Budget exhausted → friendly message.
- Duplicate / out-of-order webhooks → cursor + `event.id` dedupe.
- Realtime drop → TanStack Query refetch on reconnect.
- Concurrent user turns while running → Managed Agents queues messages; UI may disable send while running.

## 12. Testing strategy

- **`pnpm test:edge`** (Deno) — webhook routing, HMAC verify, tool execution, draft validation/repair, idempotency; send/save functions (stub the Anthropic SDK, à la `AI_MOCK_MODE`).
- **`pnpm test:db`** — RLS on both new tables (members read own household; non-members denied; editor-only insert) + the save path.
- **Component tests** — chat UI + preview card.
- **Playwright visual validation** — full flow (signup → draft → iterate → save) at desktop + mobile viewports, per CLAUDE.md.
- CI migration-diff is satisfied by the new migration files.

## 13. One-time setup (control plane)

A setup script (or `ant` YAML) that:
1. Creates the Environment (`cloud`, `networking: limited`).
2. Creates the Agent (model, system prompt, web tools, 3 custom tools).
3. Prints `RECIPE_AGENT_ID` + `RECIPE_ENV_ID` → store via `supabase secrets set`.
4. Generates the webhook signing key, store as `ANTHROPIC_WEBHOOK_SIGNING_KEY`; register the `recipe-chat-webhook` URL in the Anthropic Console for `session.status_run_started`, `session.status_idled`, `session.status_terminated`.

## 14. Open questions / assumptions

- **Assumption:** chat access is gated to household **editors** (drafting toward a save is an editor action); `save_recipe` enforces its own membership check internally.
- **Assumption:** development targets the hosted Supabase project (or a tunnel) so the webhook is reachable; production uses the deployed edge function URL.
- **Future (v2):** memory store for cross-session taste; hero-image generation; in-card editing; chat-history browser; stale-session reaper.
