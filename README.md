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
- `GEMINI_API_KEY`: the server-managed Gemini key used by the design agent

Create the Better Auth tables and start the app:

```bash
bun run db:migrate
bun run dev
```

Better Auth and canvas designs use Drizzle ORM through Neon's fetch-based HTTP driver. The generated migrations live in `drizzle/`.

## Commands

```bash
bun run dev          # development server on port 3000
bun run build        # production build
bun run test         # Vitest
bun run db:generate  # generate SQL after schema changes
bun run db:migrate   # apply pending migrations
bun run db:studio    # open Drizzle Studio
```

Canvas documents, shapes, version history, and multiple agent chats per design are stored per user in Postgres through the authenticated oRPC API at `/api/rpc`. The agent uses the server-managed `gemini-3.5-flash` model; model credentials are never sent to or stored in the browser.
