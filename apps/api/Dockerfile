# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
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
COPY packages/railway/package.json packages/railway/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages

USER bun
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
# The API service is the sole deploy-time migration owner.
CMD ["sh", "-c", "bun run --cwd packages/db migrate:deploy && exec bun --smol run apps/api/src/index.ts"]
