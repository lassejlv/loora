# `loora-mcp-server`

Pure Rust MCP transport for Loora. It preserves the OAuth resource metadata,
stateless Streamable HTTP endpoint, stdio mode, and 33-tool catalog.

Tool execution is intentionally delegated to the private
`/api/internal/mcp` web endpoint. That endpoint uses the canonical TypeScript
Canvas engine, branch/history persistence, Polar metering, realtime publisher,
exporter, screenshot renderer, and asset isolation. The Rust service therefore
does not maintain a second implementation of Loora's document semantics.

## Run

Set `MCP_INTERNAL_TOKEN` to the same private secret on the web and MCP services.
`MCP_INTERNAL_API_URL` defaults to `${BETTER_AUTH_URL}/api/internal/mcp`; set it
to the web service's private Railway URL in production when available.

```sh
cargo run -p loora-mcp-server
```

For local stdio clients, also set `LOORA_MCP_USER` to an account id or email:

```sh
cargo run -p loora-mcp-server -- --stdio
```

The HTTP service exposes:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Stateless MCP JSON-RPC |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth resource metadata |
| `GET` | `/.well-known/oauth-protected-resource/mcp` | Path-form OAuth metadata |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Canonical execution-service readiness |

## Validate

```sh
cargo fmt --all -- --check
cargo test -p loora-mcp-server
cargo clippy -p loora-mcp-server --all-targets -- -D warnings
```
