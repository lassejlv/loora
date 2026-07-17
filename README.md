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

Create the Better Auth tables and start the app:

```bash
bun run db:migrate
bun run dev
```

Better Auth uses Drizzle ORM through Neon's fetch-based HTTP driver. The generated migration lives in `drizzle/`.

## Commands

```bash
bun run dev          # development server on port 3000
bun run build        # production build
bun run test         # Vitest
bun run db:generate  # generate SQL after schema changes
bun run db:migrate   # apply pending migrations
bun run db:studio    # open Drizzle Studio
```

Canvas documents and version history are currently stored in the browser. Authentication protects access to the editor and its model APIs, but does not yet sync canvas data to Postgres.
