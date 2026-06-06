set search_path = app, public;

-- Conversational recipe-drafting sessions. Each row maps to an Anthropic
-- Managed Agents session. The webhook updates rows via the service role
-- (bypasses RLS); the send/save functions and SPA read/insert under the
-- caller's JWT, governed by the policies below.
create table app.recipe_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  anthropic_session_id text not null unique,
  status text not null default 'running'
    check (status in ('running','idle','saved','error','terminated')),
  current_draft jsonb,
  events_cursor text,
  draft_repair_attempts integer not null default 0,
  title text,
  recipe_id uuid references app.recipes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipe_chat_sessions_household_idx
  on app.recipe_chat_sessions (household_id, created_at desc);

create trigger recipe_chat_sessions_set_updated before update
  on app.recipe_chat_sessions
  for each row execute function app.set_updated_at();

create table app.recipe_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null
    references app.recipe_chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','agent')),
  content text not null,
  created_at timestamptz not null default now()
);
create index recipe_chat_messages_session_idx
  on app.recipe_chat_messages (chat_session_id, created_at);

-- Recipe-chat-scoped RLS helpers (SECURITY DEFINER + plpgsql to prevent
-- inlining, mirroring app.is_recipe_visible / app.is_recipe_editor).
create or replace function app.is_chat_session_visible(s uuid)
returns boolean language plpgsql stable security definer
set search_path = app, public as $$
declare result boolean;
begin
  select app.is_household_member(cs.household_id) into result
    from app.recipe_chat_sessions cs where cs.id = s;
  return coalesce(result, false);
end;
$$;

create or replace function app.is_chat_session_editor(s uuid)
returns boolean language plpgsql stable security definer
set search_path = app, public as $$
declare result boolean;
begin
  select app.is_household_editor(cs.household_id) into result
    from app.recipe_chat_sessions cs where cs.id = s;
  return coalesce(result, false);
end;
$$;

alter table app.recipe_chat_sessions enable row level security;
alter table app.recipe_chat_messages enable row level security;

create policy recipe_chat_sessions_read on app.recipe_chat_sessions
  for select using (app.is_household_member(household_id));
create policy recipe_chat_sessions_write on app.recipe_chat_sessions
  for all using (app.is_household_editor(household_id))
  with check (app.is_household_editor(household_id));

create policy recipe_chat_messages_read on app.recipe_chat_messages
  for select using (app.is_chat_session_visible(chat_session_id));
create policy recipe_chat_messages_write on app.recipe_chat_messages
  for all using (app.is_chat_session_editor(chat_session_id))
  with check (app.is_chat_session_editor(chat_session_id));

grant select, insert, update, delete on app.recipe_chat_sessions to authenticated;
grant select, insert, update, delete on app.recipe_chat_messages to authenticated;

do $$ begin
  alter publication supabase_realtime add table app.recipe_chat_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table app.recipe_chat_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
