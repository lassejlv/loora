# `@loora/ws` — realtime service

`ws.loora.design`. One WebSocket per open document, carrying canvas
invalidations, agent activity from MCP tool calls, and collaborator cursors.

```
browser ──ticket──> web (/api/realtime-ticket)      access checks live here
browser ──socket──> ws  (/canvas?ticket=…)          this service
web / mcp ─HTTP──-> ws  (/publish, /state)          server-side events
ws  <──pub/sub──>  redis                            between ws instances
```

## Why a separate service

- A socket is a long-lived connection; the web app is a request/response
  process behind a platform proxy. Keeping them apart lets either scale on its
  own terms.
- Bun's `server.publish` fans one message out to every socket in a room, so a
  room costs one bus subscription per instance instead of one Redis subscriber
  per viewer, which is what the server-sent-events fallback pays.
- Cursors ride the socket the client already has, instead of an HTTP request
  per pointer move.

## Endpoints

| Method | Path | Who calls it |
|--------|------|--------------|
| `GET` | `/canvas` | Browser. Upgrades to a socket; the ticket rides the `Sec-WebSocket-Protocol` header (`?ticket=` still accepted). |
| `POST` | `/publish` | Web / MCP, with `Authorization: Bearer $REALTIME_INTERNAL_TOKEN`. |
| `POST` | `/state` | Web, same token. Room state for a tab connecting over SSE. |
| `GET` | `/health` | Liveness plus counts of what was turned away — refused tickets, replays, throttled publishes, dropped messages. |
| `GET` | `/ready` | Readiness: pings the bus and answers `503` when it cannot be reached, so a room that has quietly stopped being shared is visible. |

## Authentication

This process never touches the database. The web app runs every check it
already runs for the editor — session, legal consent, design access, preview
access, plan — and signs a 60-second ticket (`@loora/realtime/ticket`) that
carries the person's identity, role, and room. Presence is stamped from those
claims, so a client can say where its pointer is but never who it is.

- **Single use.** Each ticket carries a `jti` that this service claims on the
  bus (`SET NX`) as the socket connects. A second connection on the same ticket
  is a replay and is refused, so a leaked ticket is worth one connection at
  most — and the claim is shared, so it holds across instances.
- **Not in the URL.** A browser cannot set headers on a WebSocket, so the
  ticket is offered as the second subprotocol alongside `loora.realtime.v1`.
  Query strings are the part of a request proxies and edge logs keep.
- **Bounded lifetime.** A socket is closed with code `4001` after 15 minutes
  and the client reconnects with a fresh ticket, which bounds how long revoked
  access can linger.
- **Bounded fan-out.** One account may hold 20 sockets; past that the oldest is
  closed with `4002`, since the newest tab is the one somebody is looking at.
- **Bounded ingest.** `/publish` and `/state` take 6,000 requests a minute and
  bodies up to 64 KB. A publisher that is turned away falls back to Redis, so
  the ceiling degrades rather than drops.

### Rotating the ticket secret

Put the new key in `REALTIME_TICKET_SECRET` on the web app and the old one in
`REALTIME_TICKET_SECRET_PREVIOUS` here. Tickets live 60 seconds, so a minute
later the old key can be dropped.

## Messages

Client → server: `{"type":"presence","cursor":{"x":0,"y":0},"selection":[]}`
and `{"type":"ping"}`. Nothing else is accepted; canvas changes and agent
activity come from the server side through `/publish`.

A presence frame is not echoed to the socket that sent it — its author already
knows where its own cursor is, and at frame rate that echo was a message per
move. Everything else fans out to the whole room.

Server → client: `ready` (room state on connect), then the shared
`@loora/realtime/events` shapes — `canvas.changed`, `agent.activity`,
`presence.peer`, `presence.state` — plus `pong`.

## Configuration

| Variable | Meaning |
|----------|---------|
| `PORT` | Listen port (default `4200`). |
| `REALTIME_TICKET_SECRET` | Shared with the web app; verifies tickets. ≥32 chars. |
| `REALTIME_TICKET_SECRET_PREVIOUS` | Optional. The key being retired, still accepted while tickets signed with it expire. |
| `REALTIME_INTERNAL_TOKEN` | Shared with web/MCP; guards `/publish` and `/state`. ≥32 chars. |
| `REDIS_URL` | Optional. Without it the service is a single instance and rooms live in memory — fine for local development. |
| `REALTIME_ALLOWED_ORIGINS` | Optional comma-separated allowlist; falls back to `BETTER_AUTH_URL`. |

Local: `bun run --cwd apps/ws dev` (or `bun run dev:ws` from the root).

## Tests

Most of the suite runs against the in-memory bus, which is one process
pretending to be a room. `redis-bus.test.ts` is the other half: it starts a
`redis-server`, stands up two instances against it, and checks the three things
only Redis decides — events crossing instances, presence being one shared room,
and a ticket being spent across the deployment rather than once per process.
Without the binary on PATH that file skips rather than pretending to have
checked.
