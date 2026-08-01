# syntax=docker/dockerfile:1
# ws.loora.design — realtime WebSocket service. Runs TS straight through Bun,
# no build step, and needs neither the database nor the canvas package: it only
# verifies tickets and fans events out.

FROM oven/bun:1.3.14 AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY apps/ws/package.json apps/ws/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/email/package.json packages/email/
COPY packages/billing/package.json packages/billing/
COPY packages/agent/package.json packages/agent/
COPY packages/canvas/package.json packages/canvas/
COPY packages/platform/package.json packages/platform/
COPY packages/shell/package.json packages/shell/
COPY packages/realtime/package.json packages/realtime/
COPY packages/rpc/package.json packages/rpc/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4200

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ws/node_modules ./apps/ws/node_modules
COPY --from=deps /app/packages/realtime/node_modules ./packages/realtime/node_modules
COPY package.json bun.lock bunfig.toml ./
COPY apps/ws ./apps/ws
COPY packages/realtime ./packages/realtime

USER bun
EXPOSE 4200

# Sockets are cheap; the heap is not. --smol keeps idle memory down on a
# process whose job is mostly waiting.
CMD ["bun", "--smol", "run", "apps/ws/src/index.ts"]
