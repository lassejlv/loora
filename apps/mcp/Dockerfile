# syntax=docker/dockerfile:1
# mcp.loora.design — remote MCP server. Runs TS straight through Bun, no
# build step; only needs deps plus the workspace packages it imports.

FROM oven/bun:1.3.14 AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/agent/package.json packages/agent/
COPY packages/rpc/package.json packages/rpc/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4100

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY package.json bun.lock bunfig.toml ./
COPY apps/mcp ./apps/mcp
COPY packages/db ./packages/db
COPY packages/auth ./packages/auth

USER bun
EXPOSE 4100

CMD ["bun", "run", "apps/mcp/src/index.ts"]
