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
- `PORT` — defaults to 4100
- `LOORA_MCP_USER` — stdio mode only: email or id of the acting user

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
with the web service.

## Draft targets

Element and history tools accept an optional `draftId`; omitting it keeps the
backward-compatible Main behavior. Draft lifecycle tools are:

- `list_drafts`, `create_draft`
- `propose_draft`, `reopen_draft`, `close_draft`
- `compare_draft`, `apply_draft`

`compare_draft` returns the current Main and draft revisions plus whole-element
and layer-order conflicts. Pass those revisions and one `main` or `draft`
choice for every conflict to `apply_draft`.

Main and draft element writes use revision-checked retries. That preserves
unrelated browser or MCP changes and returns the resolved target revision.
Proposed, applied, and closed drafts are read-only.
