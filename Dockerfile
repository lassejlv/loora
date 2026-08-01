# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS deps
WORKDIR /app

# Workspace manifests only, so dependency layers cache until a package.json,
# the lockfile, or bunfig (isolated linker config) changes.
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

FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY --from=deps /app ./
# Keep .gitignore in the image context so Tailwind v4 produces
# matching CSS hashes for client and SSR builds.
COPY . .

# Railway exposes service variables to Docker builds as build args, but only
# declared ARGs reach the build env — without this line Vite inlines nothing.
ARG VITE_DATABUDDY_CLIENT_ID
ENV VITE_DATABUDDY_CLIENT_ID=$VITE_DATABUDDY_CLIENT_ID
# Diagnostic: length 0 in the build log means Railway did not deliver the arg.
RUN echo "VITE_DATABUDDY_CLIENT_ID length: ${#VITE_DATABUDDY_CLIENT_ID}"

RUN bun run --cwd apps/web build --logLevel warn

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# The internal MCP executor owns canonical screenshots after the Rust MCP
# transport hands a tool call to the web service.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation tini \
  && rm -rf /var/lib/apt/lists/*

# The isolated linker stores real packages in node_modules/.bun and symlinks
# into it from each workspace's node_modules, so the runtime stage must mirror
# the full workspace topology (root store + every per-package node_modules).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/packages/billing/node_modules ./packages/billing/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/canvas/node_modules ./packages/canvas/node_modules
COPY --from=deps /app/packages/platform/node_modules ./packages/platform/node_modules
COPY --from=deps /app/packages/shell/node_modules ./packages/shell/node_modules
COPY --from=deps /app/packages/realtime/node_modules ./packages/realtime/node_modules
COPY --from=deps /app/packages/rpc/node_modules ./packages/rpc/node_modules
COPY --from=deps /app/packages/editor/node_modules ./packages/editor/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/email ./packages/email
COPY packages/billing/package.json packages/billing/
COPY packages/agent/package.json packages/agent/
COPY packages/canvas ./packages/canvas
COPY packages/platform ./packages/platform
COPY packages/shell/package.json packages/shell/
COPY packages/realtime ./packages/realtime
COPY packages/rpc/package.json packages/rpc/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
COPY packages/db ./packages/db
COPY --from=build /app/apps/web/.output ./apps/web/.output

USER bun
EXPOSE 3000

# --smol trades GC frequency for a smaller heap; CPU sits near zero in
# production so the tradeoff is free memory.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "bun run --cwd packages/db migrate:deploy && exec bun --smol run apps/web/.output/server/index.mjs"]
