# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Keep .gitignore in the image context so Tailwind v4 produces
# matching CSS hashes for client and SSR builds.
RUN bun run build

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts ./
COPY drizzle ./drizzle

USER bun
EXPOSE 3000

CMD ["sh", "-c", "bun --env-file=.env run drizzle-kit migrate && exec bun run .output/server/index.mjs"]
