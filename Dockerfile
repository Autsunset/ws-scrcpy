# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-trixie-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=optional --ignore-scripts --no-audit --no-fund

COPY LICENSE tsconfig.json ./
COPY src ./src
COPY typings ./typings
COPY vendor ./vendor
COPY webpack ./webpack
COPY docker/build.config.json ./build.config.override.json
RUN npm run dist \
    && npm prune --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends adb \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node -m 0700 /home/node/.android

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/home/node \
    WS_SCRCPY_AUTH_REQUIRED=1
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/ws-scrcpy-entrypoint

USER node
EXPOSE 8000
ENTRYPOINT ["ws-scrcpy-entrypoint"]
CMD ["node", "dist/index.js"]
