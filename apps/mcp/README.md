# `@loora/mcp`

Legacy TypeScript MCP transport retained as a compatibility oracle during the
Rust migration. Production `mcp.loora.design` is built from
`crates/mcp-server`; the canonical tool executor now lives in
`@loora/rpc/mcp-server` and is shared by this app and the web app's private
`POST /api/internal/mcp` route.

The shared executor still owns all 33 tools and continues to use the canonical
Canvas engine, branch/history persistence, Polar usage metering, realtime
publisher, code exporter, screenshot renderer, and asset isolation.

## Legacy validation

```bash
bun run --cwd apps/mcp dev
bun run --cwd apps/mcp stdio
bun test --preload ./apps/web/src/test/setup.ts apps/mcp/src
```

New local and production clients should run `crates/mcp-server`. See
`crates/mcp-server/README.md` for its environment and commands.
