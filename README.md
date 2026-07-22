# Loora

The design harness for AI-assisted UI and UX, built with Bun, TanStack Start, Drizzle ORM, and Better Auth.

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
- `OPENROUTER_API_KEY`: the server-managed OpenRouter key used by the default models
- `LWC_SECRET`: a stable random secret used to encrypt Login with ChatGPT sessions (`openssl rand -hex 32`)
- `CODEX_CLIENT_VERSION`: Codex protocol version used for ChatGPT model discovery (defaults to `0.145.0`)

Google login is enabled only when both of these optional values are set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Register `${BETTER_AUTH_URL}/api/auth/callback/google` as an authorized redirect URI in Google
Cloud (for example, `http://localhost:3000/api/auth/callback/google` locally).

### GitHub repository access

Create a GitHub App when you want users to attach repository context to a Loora design. Configure
the app with only **Contents: read-only** repository permission (Metadata is added by GitHub), enable
expiring user authorization tokens and **Redirect on update**, and use these URLs. Leave **Request
user authorization (OAuth) during installation** off because Loora starts the PKCE authorization
flow before installation.

- Callback URL: `${BETTER_AUTH_URL}/api/github/callback`
- Setup URL: `${BETTER_AUTH_URL}/api/github/setup`
- Webhook URL: `${BETTER_AUTH_URL}/api/github/webhook`

Subscribe to the `GitHub App authorization`, `Installation`, and `Installation repositories` events.
Then set `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, and
`GITHUB_WEBHOOK_SECRET`. Generate the separate encryption key with `openssl rand -base64 32` and
set it as `GITHUB_DATA_ENCRYPTION_KEY`. Changing that key invalidates stored GitHub credentials, so
keep it stable and secret.

Loora stores encrypted GitHub App user tokens and always rechecks the intersection of the user's
GitHub permissions and the app installation before reading. The agent can list, search, and read
bounded source/image files; it has no repository write tools. Repository payloads are not retained
in saved chats.

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
- `packages/auth` — Better Auth, preview access, billing, and Polar integration (`@loora/auth`)
- `packages/agent` — model policy, prompts, tools, usage, and server agent runtime (`@loora/agent/*`)
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

Providers and models live in one typed catalog: [`packages/agent/src/models.ts`](packages/agent/src/models.ts).
Server-managed models use OpenRouter. GLM is pinned to Wafer's standard or fast endpoint, while
MiniMax M3 uses MiniMax's endpoint because OpenRouter does not currently offer it through Wafer. ChatGPT-backed models use each
user's connected ChatGPT account and are only shown when that account reports the model as available.

The managed provider uses one server-side OpenRouter key:

```ts
export const PROVIDERS = {
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
} as const satisfies Record<string, ProviderDefinition>
```

Then add models with any Loora label and upstream model ID:

```ts
{
  id: 'mini',
  label: 'Mini',
  provider: 'openrouter',
  modelId: 'minimax/minimax-m3',
  routingProvider: 'minimax',
  supportsImageInput: true,
  price: { input: 1.2, output: 4.9 },
}
```

Use `routingProvider: 'wafer/fp4'` for standard Wafer or `'wafer/fast'` for its fast endpoint.
Finally, set `OPENROUTER_API_KEY`. The provider name is shown beside each model in the picker.
