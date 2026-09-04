# Current Goal

## Objective
Replace `crates/mcp-server` with a Cloudflare Worker that preserves Loora's remote MCP contract: Streamable HTTP, OAuth resource server, rate limiting, and authenticated forwarding of the canonical tools to `POST /api/internal/mcp`. Remove the Rust crate from workspace, Docker/Railway, and root scripts, and update docs so local and production MCP run as a Worker.

## Status
completed

## Definition of done
- [x] Cloudflare Worker implements Streamable HTTP MCP at `/mcp` with the same tool manifest and forwarding to `/api/internal/mcp`
- [x] OAuth resource-server behavior (WWW-Authenticate, token verification) is preserved
- [x] Rate limiting is preserved (Cloudflare bindings in production; Redis/memory locally)
- [x] Rust crate, its Docker/Railway deploy, and `cargo run -p loora-mcp-server` scripts are gone
- [x] Root scripts, AGENTS.md, README, dump-mcp-tools, and tests point at the Worker
- [x] Typecheck and focused tests pass; Worker can be run locally (`wrangler` / `bun run dev:mcp`)

## Constraints
- Keep `@loora/rpc/mcp-server` as the canonical 33 tool handlers
- Do not move canvas execution into the Worker
- Preserve public endpoint `https://mcp.loora.design/mcp`
- Stdio is local-only; Workers cannot serve it natively — provide a local adapter if the repo currently depends on `dev:mcp:stdio`

## Progress
- Added `apps/mcp` Worker (stateless JSON-RPC, OAuth resource server, 33-tool manifest).
- Removed `crates/mcp-server` from Cargo workspace, Docker, and Railway.
- Local HTTP is Bun.serve on `:4100`; production is `wrangler deploy`.

## Evidence
- `bun run test apps/mcp`: 16 passed
- `wrangler deploy --dry-run`: 278.57 KiB bundle, rate-limit bindings present
- Smoke: `/health` 200, OAuth metadata 200, unauthorized `/mcp` 401 with resource_metadata
- `bunx tsc --noEmit`: no `apps/mcp` errors

## Next action
Clear the saved goal when its record is no longer needed.

## Blocker
None.
