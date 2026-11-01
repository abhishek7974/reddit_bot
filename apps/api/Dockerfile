# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f apps/api/Dockerfile .
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@11.0.9 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Full install + build. Also used as the one-off migration image (`--target migrate`).
FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@careerconnect/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @careerconnect/api build

FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# Production dependencies only.
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@careerconnect/api..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
# The same image runs the worker: override with `node dist/worker.js`.
CMD ["node", "dist/server.js"]
