-- Agent replies can now be written by two paths: the webhook (when the session
-- idles) and recipe-chat-progress (polled by the SPA while the agent is still
-- running, so a reply shows up before the draft finishes generating). Both key
-- the row on the Managed Agents event id, so whichever path sees an
-- agent.message first inserts it and the other skips it via ON CONFLICT.
-- Nullable: user messages and pre-existing / mock-mode agent rows have no event.
alter table app.recipe_chat_messages
  add column anthropic_event_id text unique;
