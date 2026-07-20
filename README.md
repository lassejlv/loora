# loora

A local-first canvas editor with an AI design agent, built with TanStack Start and Bun.

## Setup

Install dependencies and create your local environment file:

```bash
bun install
cp .env.example .env
```

Set these values in `.env`:

- `DATABASE_URL`: a Neon PostgreSQL connection string
- `BETTER_AUTH_SECRET`: at least 32 random characters
- `BETTER_AUTH_URL`: the public app origin, usually `http://localhost:3000` locally
- `REQUIRE_PREVIEW_ACCESS`: defaults to required; set to `false` to let every signed-in user in
- `WAFER_API_KEY`: the server-managed Wafer key used by the default models
- `LWC_SECRET`: a stable random secret used to encrypt Login with ChatGPT sessions (`openssl rand -hex 32`)
- `CODEX_CLIENT_VERSION`: Codex protocol version used for ChatGPT model discovery (defaults to `0.145.0`)

Google login is enabled only when both of these optional values are set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Register `${BETTER_AUTH_URL}/api/auth/callback/google` as an authorized redirect URI in Google
Cloud (for example, `http://localhost:3000/api/auth/callback/google` locally).

Create the Better Auth tables and start the app:

```bash
bun run db:migrate
bun run dev
```

Better Auth and canvas designs use Drizzle ORM through Neon's fetch-based HTTP driver. The generated migrations live in `packages/db/drizzle/`.

## Monorepo layout

Bun workspaces (no turborepo/pnpm), configured in the root `package.json` and `bunfig.toml`
(isolated linker, `run.bun`). One `bun.lock` at the root; shared dependency versions are pinned
in the workspace catalog.

- `apps/web` — the TanStack Start app (routes, components, canvas, agent panel)
- `packages/db` — Drizzle schema, Neon client, migrations, drizzle-kit config (`@loora/db`)
- `packages/auth` — Better Auth instance, billing/Polar, spend limits, model catalog (`@loora/auth`)
- `packages/rpc` — the oRPC router plus storage/handoff/history (`@loora/rpc`)

Packages export TypeScript source directly; Vite and Bun resolve them via workspace symlinks
and the root `tsconfig.json` paths.

## Commands

```bash
bun run dev          # development server on port 3000
bun run build        # production build
bun run test         # Vitest
bun run db:generate  # generate SQL after schema changes
bun run db:migrate   # apply pending migrations
bun run db:studio    # open Drizzle Studio
```

Canvas documents, shapes, version history, and multiple agent chats per design are stored per user in Postgres through the authenticated oRPC API at `/api/rpc`. Model credentials are never sent to or stored in the browser.

## AI providers and models

Providers and models live in one typed catalog: [`packages/auth/src/models.ts`](packages/auth/src/models.ts).
Server-managed providers use an OpenAI-compatible API. ChatGPT-backed models use each
user's connected ChatGPT account and are only shown when that account reports the model as available.

To add a provider, add its label, base URL, and API-key environment variable:

```ts
export const PROVIDERS = {
  wafer: {
    kind: 'openai-compatible',
    label: 'Wafer',
    baseURL: 'https://pass.wafer.ai/v1',
    apiKeyEnv: 'WAFER_API_KEY',
  },
  openrouter: {
    kind: 'openai-compatible',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
} as const satisfies Record<string, ProviderDefinition>
```

Then add models with any Loora label and upstream model ID:

```ts
{
  id: 'sonnet',
  label: 'Claude Sonnet',
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
  supportsImageInput: true,
  price: { input: 3, output: 15 },
}
```

Finally, set the provider's API-key environment variable. The provider name is shown beside each model in the picker.
