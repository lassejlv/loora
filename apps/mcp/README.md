# @loora/mcp

Remote MCP server for Loora (mcp.loora.design). Streamable HTTP endpoint at
`/mcp`; OAuth 2.1 with loora.design as the authorization server (Better Auth
`mcp` plugin — PKCE + dynamic client registration, so Claude Code, Codex,
opencode, etc. connect without any pre-registered client).

## How auth fits together

1. Client POSTs `/mcp` without a token → 401 with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
2. That metadata points `authorization_servers` at the web app's origin
   (`BETTER_AUTH_URL`), whose OAuth metadata lives at
   `/.well-known/oauth-authorization-server` (served by apps/web) and
   `/api/auth/.well-known/oauth-authorization-server` (served by Better Auth).
3. Client registers dynamically, sends the user through
   `/api/auth/mcp/authorize` — unauthenticated users land on the app root to
   sign in and the flow resumes — and exchanges the code for a token.
4. Tokens live in the shared database; this server validates them with
   `auth.api.getMcpSession` and then applies the same gates as the oRPC
   `protectedProcedure` (preview access + active plan).

## Env

Same `.env` as the web app (`DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`), plus:

- `MCP_PUBLIC_URL` — public origin of this server, e.g. `https://mcp.loora.design`
- `LOORA_APP_URL` — canonical web app origin used in returned editor links
- `PORT` — defaults to 4100
- `LOORA_MCP_USER` — stdio mode only: email or id of the acting user
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — optional local Chromium override;
  the Railway image installs Chromium at `/usr/bin/chromium`

Optionally set `MCP_RESOURCE_URL=https://mcp.loora.design/mcp` for the web app
so Better Auth's own protected-resource metadata names the right resource.

## Run

```bash
bun run --cwd apps/mcp dev     # HTTP on :4100
bun run --cwd apps/mcp stdio   # local stdio mode, no OAuth (LOORA_MCP_USER)
```

Connect from Claude Code:

```bash
claude mcp add --transport http loora https://mcp.loora.design/mcp
```

Local stdio (no OAuth):

```json
{
  "mcpServers": {
    "loora": {
      "command": "bun",
      "args": ["run", "--cwd", "apps/mcp", "stdio"],
      "env": { "LOORA_MCP_USER": "you@example.com" }
    }
  }
}
```

## Deploy

Separate Railway service off the same repo, config `apps/mcp/railway.json`
(builds `apps/mcp/Dockerfile`). Point mcp.loora.design at it. Migrations stay
with the web service. Set the same `REDIS_URL` on both the web and MCP
services so Canvas changes and agent activity reach open editors immediately.

## Agent workflow

1. `listDesigns`, then `getDesignContext`.
2. Build through `createPage`, `insertNodes`, `patchNodes`, components, tokens,
   and the other structured mutation tools. These all commit validated Canvas
   transactions through the same engine as the web editor.
3. Call `getScreenshot` after meaningful edits. It returns real `image/png`
   MCP content for a Page or NodeRef; outbound document URLs are blocked and
   owned image assets are inlined.
4. Call `exportCode` with `tailwind`, `jsx`, or `html` when implementation code
   is needed. Tailwind output is JSX with literal utilities and no hidden
   generated stylesheet.

Canvas source remains structured. HTML, JSX, and Tailwind are one-way exports,
not editable code blobs inside the document.

Most target tools accept an optional `draftId`; omit it for Main. Branch
lifecycle tools are `listBranches`, `createBranch`, `proposeBranch`,
`reopenBranch`, `compareBranch`, `applyBranch`, and `closeBranch`. Proposed,
applied, and closed branches are read-only.
