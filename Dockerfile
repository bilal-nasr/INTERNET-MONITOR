# syntax=docker/dockerfile:1

# Build and run mikrotik-quota-monitor as a self-contained image.
#   docker build -t mikrotik-quota-monitor .
#   docker run --rm -p 3000:3000 --env-file .env.local mikrotik-quota-monitor
#
# No secrets are baked in: DATABASE_URL, CRON_SECRET and the rest are read from
# the environment at startup, so the same image works in every environment.

ARG NODE_VERSION=24-alpine

# ---------- base: node + pnpm --------------------------------------------------
FROM node:${NODE_VERSION} AS base
# Next.js needs gcompat on Alpine for some native bindings.
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# Corepack installs the exact pnpm version pinned in package.json.
RUN corepack enable
WORKDIR /app

# ---------- deps: install from the lockfile ------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build: compile the app --------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build must not need a database: pages are dynamic and the pool is lazy.
RUN pnpm build

# ---------- runner: minimal runtime image --------------------------------------
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Kept in the image so the schema can be applied from a running container.
COPY --from=build --chown=nextjs:nodejs /app/schema.sql ./schema.sql

USER nextjs
EXPOSE 3000

# Reports unhealthy when the app cannot reach the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
