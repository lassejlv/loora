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
| `GET` | `/canvas?ticket=…` | Browser. Upgrades to a socket; the ticket is minted by the web app. |
| `POST` | `/publish` | Web / MCP, with `Authorization: Bearer $REALTIME_INTERNAL_TOKEN`. |
| `POST` | `/state` | Web, same token. Room state for a tab connecting over SSE. |
| `GET` | `/health`, `/ready` | Platform checks. |

## Authentication

This process never touches the database. The web app runs every check it
already runs for the editor — session, legal consent, design access, preview
access, plan — and signs a 60-second ticket (`@loora/realtime/ticket`) that
carries the person's identity, role, and room. Presence is stamped from those
claims, so a client can say where its pointer is but never who it is. A socket
is closed with code `4001` after 15 minutes and the client reconnects with a
fresh ticket, which is what bounds how long revoked access can linger.

## Messages

Client → server: `{"type":"presence","cursor":{"x":0,"y":0},"selection":[]}`
and `{"type":"ping"}`. Nothing else is accepted; canvas changes and agent
activity come from the server side through `/publish`.

Server → client: `ready` (room state on connect), then the shared
`@loora/realtime/events` shapes — `canvas.changed`, `agent.activity`,
`presence.peer`, `presence.state` — plus `pong`.

## Configuration

| Variable | Meaning |
|----------|---------|
| `PORT` | Listen port (default `4200`). |
| `REALTIME_TICKET_SECRET` | Shared with the web app; verifies tickets. ≥32 chars. |
| `REALTIME_INTERNAL_TOKEN` | Shared with web/MCP; guards `/publish` and `/state`. ≥32 chars. |
| `REDIS_URL` | Optional. Without it the service is a single instance and rooms live in memory — fine for local development. |
| `REALTIME_ALLOWED_ORIGINS` | Optional comma-separated allowlist; falls back to `BETTER_AUTH_URL`. |

Local: `bun run --cwd apps/ws dev` (or `bun run dev:ws` from the root).
