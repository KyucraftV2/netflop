# Image unique du hub ET du worker (commande différente).
# Build multi-stage, Node 22 alpine, sortie Next.js « standalone ».

FROM oven/bun:1-alpine AS bun

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat libstdc++ libgcc
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN bun run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 netflop && adduser -S -u 1001 -G netflop netflop
COPY --from=build --chown=netflop:netflop /app/.next/standalone ./
COPY --from=build --chown=netflop:netflop /app/.next/static ./.next/static
COPY --from=build --chown=netflop:netflop /app/public ./public
# worker.js, migrate.js et test-browser.js (bundles autonomes) + migrations SQL
COPY --from=build --chown=netflop:netflop /app/dist/ ./
COPY --from=build --chown=netflop:netflop /app/drizzle ./drizzle
USER netflop
EXPOSE 3000
CMD ["node", "server.js"]
