# Recipe-chat (Managed Agents) — one-time setup runbook

The recipe-drafting chat runs on Anthropic Managed Agents. The code lives in the
repo; these steps wire it to your Anthropic account and Supabase project. They
require your Anthropic API key and Supabase access, so a maintainer runs them —
they are intentionally **not** part of CI. Later config changes are synced by
the deploy workflow (see "Keeping the agent in sync").

## 1. Create the Agent + Environment

```sh
ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/managed-agents/setup.ts
```

Copy the printed `RECIPE_ENV_ID` and `RECIPE_AGENT_ID`.

### Keeping the agent in sync

The agent's model, effort, system prompt and tools, and the environment's
networking, are defined in `supabase/functions/_shared/agents/config.ts`.
`scripts/managed-agents/update.ts` pushes them to Anthropic. It finds the agent
by name and the environments by name prefix, and leaves an unchanged agent
alone. It runs:

- **Automatically**, as the last step of every production deploy, once the
  `ANTHROPIC_API_KEY` repository secret is set (GitHub → Settings → Secrets
  and variables → Actions). Without the secret, the step is skipped.
- **On demand**, from the **Sync recipe agent** workflow (Actions tab →
  Run workflow; also works in the GitHub mobile app).
- **By hand**: `ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/managed-agents/update.ts`.

Each agent change creates a new agent version. New chats pick it up
immediately; chats already started keep the version they were created on.

The environment runs with `unrestricted` networking because `web_search` obeys
it: under `limited` with no `allowed_hosts`, search returns no results. The
agent has no sandbox tools, so nothing else uses that egress.

## 2. Set Supabase secrets

```sh
supabase secrets set \
  RECIPE_AGENT_ID=agent_... \
  RECIPE_ENV_ID=env_... \
  ANTHROPIC_WEBHOOK_SIGNING_KEY=whsec_...   # from step 4
```

`ANTHROPIC_API_KEY` is already set (the import functions use it).

## 3. Deploy the functions

```sh
pnpm fn:deploy
```

Deploys `recipe-chat-send`, `recipe-chat-progress`, `recipe-chat-webhook`, and
`recipe-chat-save`. `recipe-chat-progress` is polled by the app while the agent
works: it reports what the agent is doing and stores the agent's opening reply
before the session idles, so the cook sees text before the full draft lands.

## 4. Register the webhook

In the Anthropic Console → **Manage → Webhooks**, add the deployed
`recipe-chat-webhook` URL
(`https://<project-ref>.supabase.co/functions/v1/recipe-chat-webhook`) and
subscribe to:

- `session.status_run_started`
- `session.status_idled`
- `session.status_terminated`

Copy the `whsec_...` signing secret it shows, put it into step 2, and re-run
`supabase secrets set` if you'd set a placeholder earlier.

## 5. Verify

Open the app → a household → **Draft with AI**, send a vibe + ingredients, and
confirm the agent replies and a draft preview appears. Refine, then **Save to
pantry** and confirm it lands in the recipe list.

## Local development

Webhooks need a public HTTPS URL, so they cannot reach `localhost`. Pick one:

- Develop against the deployed project (functions deployed + webhook registered).
- Expose the webhook with a tunnel, e.g.
  `cloudflared tunnel --url http://localhost:54321`, and register the tunnel's
  `/functions/v1/recipe-chat-webhook` URL in the Console.
- Set `AI_MOCK_MODE=1` to exercise the SPA + functions against canned agent
  responses with no Anthropic calls and no webhook (used by the e2e flow).
