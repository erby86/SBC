# Build context: repository root.
#   docker build -f apps/worker/Dockerfile -t sbc-noc-worker .
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN pnpm turbo run build --filter=@sbc-noc/worker...
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @sbc-noc/worker deploy --prod --legacy --store-dir /pnpm/store /out

FROM node:24-bookworm-slim AS runtime
# Runtime runs only `node`: drop the bundled npm/corepack/yarn (their own node_modules carry
# CVEs Trivy flags) and pull Debian security fixes newer than the base image.
# OS_REFRESH (deploy.sh passes today's date) makes this layer rebuild daily; without it a cached
# layer keeps yesterday's packages and Trivy stops the release on a fix published since.
ARG OS_REFRESH=
RUN echo "os refresh: ${OS_REFRESH}" && apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
CMD ["node", "dist/main.js"]
