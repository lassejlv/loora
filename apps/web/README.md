# Loora web app

The TanStack Start app targets Cloudflare Workers by default. Vite uses the
Cloudflare plugin for both development and production builds, so local preview
and deployment exercise the same Worker runtime.

## Cloudflare resources

`wrangler.jsonc` declares two bindings:

- `ASSETS_BUCKET` — R2 storage for uploaded assets. Create the production and
  preview buckets named in the config, or change the names to existing buckets.
- `BROWSER` — Browser Rendering, used by the MCP canvas screenshot tools.
  Development uses the remote binding, so screenshot calls require a logged-in
  Wrangler session and consume the account's Browser Run allowance.

Create the configured R2 buckets once:

```bash
bunx wrangler r2 bucket create loora
bunx wrangler r2 bucket create loora-preview
```

Set runtime configuration as Worker secrets or environment variables. Use
`.env.example` as the inventory; at minimum the app needs `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGIN`, and `LWC_SECRET`.
Production billing, OAuth, email, GitHub, realtime, and publishing settings are
required when those surfaces are enabled. Enter sensitive values directly with
Wrangler and never add them to `wrangler.jsonc`:

```bash
bunx wrangler secret put DATABASE_URL
bunx wrangler secret put BETTER_AUTH_SECRET
```

`DATABASE_URL` must be a Worker-reachable PostgreSQL URL. Run database
migrations separately before deploying; the Worker does not migrate the schema
at startup.

The migration's Wrangler dry-run reports a 3,934.89 KiB gzip-compressed Worker.
That is above the 3 MB Workers Free script limit and below the 10 MB Workers
Paid limit, so this app currently requires a paid Workers plan unless the
server bundle is reduced.

For local development, the existing root `.env` is loaded by the Vite script.
For direct `wrangler dev` commands, put the same local-only values in an ignored
`apps/web/.dev.vars` file.

## Commands

From the repository root:

```bash
bun run dev
bun run build
bun run preview
bun run deploy:web
```

Regenerate binding types after editing `wrangler.jsonc`:

```bash
bun run --cwd apps/web cf-typegen
```

The Cloudflare build replaces the Bun-only storage and screenshot adapters with
R2 and Browser Rendering implementations. Realtime publishing uses the
`apps/ws-server` ingest endpoint; Workers do not open the Bun Redis client used
by the SSE fallback.

## Railway rollback path

The previous Bun/Nitro target remains available while the migration settles:

```bash
bun run build:railway
bun run start:railway
```

The root `Dockerfile` deliberately uses `build:railway`.
