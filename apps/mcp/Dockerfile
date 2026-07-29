# syntax=docker/dockerfile:1
# mcp.loora.design — remote MCP server. Runs TS straight through Bun, no
# build step; only needs deps plus the workspace packages it imports.

FROM oven/bun:canary AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/billing/package.json packages/billing/
COPY packages/agent/package.json packages/agent/
COPY packages/canvas/package.json packages/canvas/
COPY packages/rpc/package.json packages/rpc/
RUN bun install --frozen-lockfile

FROM oven/bun:canary-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4100

# getScreenshot renders the structured Canvas through Chromium so the MCP
# returns real PNG pixels instead of a link that still needs a browser.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /app/packages/billing/node_modules ./packages/billing/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/canvas/node_modules ./packages/canvas/node_modules
COPY --from=deps /app/packages/rpc/node_modules ./packages/rpc/node_modules
COPY package.json bun.lock bunfig.toml ./
COPY apps/mcp ./apps/mcp
COPY packages/db ./packages/db
COPY packages/auth ./packages/auth
COPY packages/billing ./packages/billing
COPY packages/agent ./packages/agent
COPY packages/canvas ./packages/canvas
COPY packages/rpc ./packages/rpc

USER bun
EXPOSE 4100

CMD ["bun", "run", "apps/mcp/src/index.ts"]
