# Loora

Loora is a canvas-based design tool where an AI agent helps you build and refine UI and UX. Draw and arrange elements on an infinite canvas, then chat with the agent to generate, edit, and arrange components — or hand off to your own ChatGPT account. Designs are saved with full version history and can be published as live, shareable pages.

Built with Bun, TanStack Start, Drizzle ORM, Better Auth, Polar billing, and a remote MCP server.

## Monorepo layout

- `apps/web` — the TanStack Start app (canvas, agent panel, routes)
- `apps/mcp` — the remote MCP server (`mcp.loora.design`)
- `packages/db` — Drizzle schema, Neon client, migrations
- `packages/auth` — Better Auth, preview access, billing, GitHub & Figma integrations
- `packages/agent` — model catalog, prompts, tools, usage accounting, agent runtime
- `packages/rpc` — the oRPC router, storage, handoff tokens, version history

License: see [LICENSE](./LICENSE).