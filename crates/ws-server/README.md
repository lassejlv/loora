# `loora-ws`

Cloudflare Worker for Loora realtime WebSockets. Durable Objects hold rooms,
presence, agent activity, single-use ticket claims, per-account connection
reservations, and the service ingest limiter. The Worker never connects to the
product database or Redis.

## Architecture

| Durable Object | Scope | Responsibility |
|----------------|-------|----------------|
| `RealtimeRoom` | owner + design + branch | Hibernatable sockets, presence, activity, broadcasts, socket TTL |
| `RealtimeUser` | account | Single-use tickets and the 20-socket account cap |
| `RealtimeIngress` | service | Internal ingest rate limiting and rejection counters |

The web app performs the normal session, legal, plan, and design-access checks,
then signs a 60-second connection ticket. The Worker verifies and spends that
ticket once. A socket is closed after 15 minutes so the client reconnects
through those checks. Identity in presence messages always comes from the
ticket, never from the browser payload.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/canvas` | WebSocket upgrade with a signed ticket |
| `POST` | `/publish` | Authenticated service event ingest |
| `POST` | `/state` | Authenticated room-state read |
| `GET` | `/health` | Liveness and rejection counters |
| `GET` | `/ready` | Secret and Durable Object readiness |

`/publish` and `/state` require `Authorization: Bearer
$REALTIME_INTERNAL_TOKEN`. Browser origins are checked against
`REALTIME_ALLOWED_ORIGINS`.

## Local development

From the repository root:

```sh
bun run dev:ws
```

The root `.env` supplies `REALTIME_TICKET_SECRET`,
`REALTIME_TICKET_SECRET_PREVIOUS`, `REALTIME_INTERNAL_TOKEN`, and
`REALTIME_ALLOWED_ORIGINS`. Safe placeholders are documented in
`.dev.vars.example`.

## Validate and deploy

```sh
bun run --cwd crates/ws-server check
bun run test:ws
bun run --cwd crates/ws-server deploy:dry-run
bun run deploy:ws
```

Production secrets are managed with Wrangler and must not be committed:

```sh
bunx wrangler secret put REALTIME_TICKET_SECRET
bunx wrangler secret put REALTIME_INTERNAL_TOKEN
```

`REALTIME_TICKET_SECRET_PREVIOUS` is optional during key rotation. The custom
domain is declared in `wrangler.jsonc` as `ws.loora.design`.

The web app may still use Redis for its SSE fallback. Server-side publishers
dual-write to the Worker and Redis when both are configured, so WebSocket and
SSE viewers receive the same events.
