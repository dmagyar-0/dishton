-- The recipe-chat agent webhook uses the service_role admin client against the
-- `app` schema, but service_role was never granted table privileges there
-- (only the `authenticated` role was). Without these grants every webhook query
-- fails with "permission denied for table ..." (42501), so custom tools like
-- list_my_recipes never resolve and the agent session hangs.
grant select on app.recipes          to service_role;
grant select on app.recipe_ingredients to service_role;
grant select on app.recipe_steps     to service_role;
grant select on app.recipe_tags      to service_role;
grant select, update on app.recipe_chat_sessions to service_role;
grant select, insert on app.recipe_chat_messages to service_role;
