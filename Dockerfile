# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.plugin.json ./
RUN npm ci
COPY plugin ./plugin
COPY scripts ./scripts
RUN npm run build:plugin
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    SENDLENS_CONTAINER=1 \
    SENDLENS_DATA_DIR=/data \
    SENDLENS_HTTP_HOST=0.0.0.0 \
    SENDLENS_HTTP_PORT=3000

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 sendlens \
  && useradd --system --uid 10001 --gid sendlens --home-dir /app --shell /usr/sbin/nologin sendlens \
  && mkdir -p /data /app/scripts \
  && chown -R sendlens:sendlens /data /app

COPY --from=build --chown=sendlens:sendlens /app/package.json /app/package-lock.json ./
COPY --from=build --chown=sendlens:sendlens /app/node_modules ./node_modules
COPY --from=build --chown=sendlens:sendlens /app/build ./build
COPY --chown=sendlens:sendlens scripts/start-container.sh ./scripts/start-container.sh

USER sendlens
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SENDLENS_HTTP_PORT || '3000') + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/scripts/start-container.sh"]
