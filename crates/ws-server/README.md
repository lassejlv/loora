# `loora-ws-server`

Rust implementation of the Loora realtime WebSocket service. It is wire-compatible
with `apps/ws`: existing browser, web, MCP, desktop, Redis, and Railway configuration
can point at this process without client changes.

## Run

From the repository root:

```sh
cargo run -p loora-ws-server
```

or with the root shortcut:

```sh
bun run dev:ws:rust
```

The service exposes the same endpoints as `apps/ws`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/canvas` | WebSocket upgrade |
| `POST` | `/publish` | Authenticated service event ingest |
| `POST` | `/state` | Authenticated room-state read |
| `GET` | `/health` | Liveness and rejection counters |
| `GET` | `/ready` | Redis/in-memory bus readiness |

It reads the existing `PORT`, `REALTIME_TICKET_SECRET`,
`REALTIME_TICKET_SECRET_PREVIOUS`, `REALTIME_INTERNAL_TOKEN`, `REDIS_URL`,
`REALTIME_ALLOWED_ORIGINS`, and `BETTER_AUTH_URL` variables. Local runs load
the repository's `.env` file automatically.

## Validate

```sh
cargo fmt --all -- --check
cargo test -p loora-ws-server
cargo clippy -p loora-ws-server --all-targets -- -D warnings
```

The tests include a ticket signed by `packages/realtime`, live WebSocket and HTTP
ingest coverage, and single-use ticket enforcement.
