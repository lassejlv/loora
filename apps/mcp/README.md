# `@loora/mcp`

Cloudflare Worker MCP transport for Loora. It preserves the OAuth resource
metadata, stateless Streamable HTTP endpoint, local stdio mode, and 33-tool
catalog.

Tool execution is delegated to the private `POST /api/internal/mcp` web
endpoint. That endpoint uses the canonical TypeScript Canvas engine,
branch/history persistence, Polar metering, realtime publisher, exporter,
screenshot renderer, and asset isolation. The Worker does not maintain a
second implementation of Loora's document semantics.

## Run

Set `MCP_INTERNAL_TOKEN` to the same private secret on the web app and this
Worker. `MCP_INTERNAL_API_URL` defaults to `${BETTER_AUTH_URL}/api/internal/mcp`;
set it to the web service's private URL in production when available.

Set `MCP_AUTHORIZATION_SERVER_URL` to the stable public OAuth authority that MCP
clients originally authenticate against (for production, `https://loora.design`).
Keep it unchanged when `BETTER_AUTH_URL` or the internal API moves between
services. If it is unset, it defaults to `BETTER_AUTH_URL` for local development
and backwards compatibility.

Local HTTP (Bun, same `fetch` handler the Worker deploys):

```sh
bun run dev:mcp
```

For local stdio clients, also set `LOORA_MCP_USER` to an account id or email:

```sh
bun run dev:mcp:stdio
```

Closest-to-production local run:

```sh
bun run --cwd apps/mcp dev:worker
```

The HTTP service exposes:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Stateless MCP JSON-RPC |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth resource metadata |
| `GET` | `/.well-known/oauth-protected-resource/mcp` | Path-form OAuth metadata |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Canonical execution-service readiness |

## Deploy

Production is a Cloudflare Worker on `mcp.loora.design`, not Railway.

```sh
bunx wrangler secret put MCP_INTERNAL_TOKEN --cwd apps/mcp
# Optional private web origin when it is not https://loora.design:
bunx wrangler secret put MCP_INTERNAL_API_URL --cwd apps/mcp
bun run --cwd apps/mcp deploy
```

Rate limits use the Worker's `ratelimits` bindings in production. Local Bun
falls back to in-memory counting, and to Redis (`REDIS_URL`) when Bun's Redis
client is available — the same `ratelimit:` key prefix as the web app.

## Validate

```sh
bun run test apps/mcp
bunx tsc --noEmit
```
