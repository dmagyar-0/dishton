-- recipe_chat RLS checks. Mirrors supabase/tests/rls.test.sql structure: the
-- runner wraps this file in a transaction and rolls back, so fixtures vanish.
-- Personas:
--   E = 00000000-0000-0000-0000-0000000000e1  (owner/editor of household H1)
--   F = 00000000-0000-0000-0000-0000000000f1  (unrelated stranger)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','chat-e@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000f1',
   'authenticated','authenticated','chat-f@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000e1','Chat Editor'),
  ('00000000-0000-0000-0000-0000000000f1','Chat Stranger')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('11111111-0000-0000-0000-000000000001','Chat H1',
   '00000000-0000-0000-0000-0000000000e1')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('11111111-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000e1','owner')
on conflict do nothing;

-- Seed a session for H1 directly (postgres bypasses RLS).
insert into app.recipe_chat_sessions (id, household_id, created_by, anthropic_session_id)
values ('22222222-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000e1','sesn_test_1')
on conflict (id) do nothing;

insert into app.recipe_chat_sessions (id, household_id, created_by, anthropic_session_id)
values ('22222222-0000-0000-0000-000000000002',
        '11111111-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000e1','sesn_test_2')
on conflict (id) do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_as(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin insert into _t_results(label, ok) values (p_label, coalesce(p_ok, false)); end;
$$;

-- Run a count under the persona's authenticated role, then reset to postgres.
create or replace function pg_temp.q_session_count(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  select count(*) into n from app.recipe_chat_sessions where id = p_session;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- Attempt a message insert under the persona; RLS denial raises, caught as 0.
create or replace function pg_temp.q_insert_message(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    insert into app.recipe_chat_messages (chat_session_id, role, content)
    values (p_session, 'user', 'hi');
    get diagnostics n = row_count;
  exception when others then n := 0;
  end;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

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

select pg_temp.check_as('editor sees own household session',
  pg_temp.q_session_count('00000000-0000-0000-0000-0000000000e1'::uuid,
                          '22222222-0000-0000-0000-000000000001'::uuid) = 1);

select pg_temp.check_as('stranger cannot see the session',
  pg_temp.q_session_count('00000000-0000-0000-0000-0000000000f1'::uuid,
                          '22222222-0000-0000-0000-000000000001'::uuid) = 0);

select pg_temp.check_as('editor can insert a message',
  pg_temp.q_insert_message('00000000-0000-0000-0000-0000000000e1'::uuid,
                           '22222222-0000-0000-0000-000000000001'::uuid) = 1);

select pg_temp.check_as('stranger cannot insert a message',
  pg_temp.q_insert_message('00000000-0000-0000-0000-0000000000f1'::uuid,
                           '22222222-0000-0000-0000-000000000001'::uuid) = 0);

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

select label, ok from _t_results order by label;
