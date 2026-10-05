# Build context: repository root.
#   docker build -f apps/web/Dockerfile -t sbc-noc-web .
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN pnpm turbo run build --filter=@sbc-noc/web...

# Unprivileged nginx (runs as uid 101, Trivy DS002). It still listens on :80 because Docker
# lets containers bind low ports without root (net.ipv4.ip_unprivileged_port_start=0), so the
# NPM proxy hosts keep forwarding to <container>:80.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
ENV API_UPSTREAM=http://noc-dev-api:3001
# --chmod: the checkout on the server may be 0600 (umask 077); nginx runs as 101 and must read it.
COPY --chmod=0644 apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
