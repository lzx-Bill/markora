FROM node:24.11.1-alpine@sha256:b3c2a6ebd4b9b3d1a3f8a58252c07b680e442e61ce1306ebdbc408ddf27cec14 AS build

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
RUN pnpm --filter @markora/api deploy --prod --legacy /opt/markora-deploy \
    && mkdir -p /opt/markora-worker/dist \
    && cp -a apps/worker/dist/. /opt/markora-worker/dist/ \
    && rm -rf /opt/markora-deploy/src /opt/markora-deploy/integration /opt/markora-deploy/tmp \
    && rm -f /opt/markora-deploy/tsconfig.json \
    && for package in /opt/markora-deploy/node_modules/@markora/*; do \
        rm -rf "$package/src" "$package/tests" "$package/integration" "$package/benchmarks"; \
    done

FROM node:24.11.1-alpine@sha256:b3c2a6ebd4b9b3d1a3f8a58252c07b680e442e61ce1306ebdbc408ddf27cec14 AS migration-deps
WORKDIR /opt/markora-migration
RUN npm install --global pnpm@10.28.2
COPY infra/docker/migration/package.json infra/docker/migration/pnpm-lock.yaml infra/docker/migration/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24.11.1-alpine@sha256:b3c2a6ebd4b9b3d1a3f8a58252c07b680e442e61ce1306ebdbc408ddf27cec14 AS runtime

ENV NODE_ENV=production \
    MARKORA_ROOT=/opt/markora \
    WEB_ROOT=/opt/markora/web/dist
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2 \
    && addgroup --system --gid 10001 markora \
    && adduser --system --uid 10001 --ingroup markora markora \
    && mkdir -p /var/lib/markora/tmp /opt/markora/web /opt/markora/migration \
    && chown -R markora:markora /var/lib/markora /opt/markora
COPY --from=build --chown=markora:markora /opt/markora-deploy /opt/markora/api
COPY --from=build --chown=markora:markora /opt/markora-worker/dist /opt/markora/worker/dist
COPY --from=build --chown=markora:markora /opt/markora/apps/web/dist /opt/markora/web/dist
COPY --from=build --chown=markora:markora /opt/markora/infra/docker/static-server.mjs /opt/markora/web/server.mjs
COPY --from=build --chown=markora:markora /opt/markora/database/prisma.config.ts /opt/markora/migration/prisma.config.ts
COPY --from=build --chown=markora:markora /opt/markora/database/schema.prisma /opt/markora/migration/schema.prisma
COPY --from=build --chown=markora:markora /opt/markora/database/migrations /opt/markora/migration/migrations
COPY --from=migration-deps --chown=markora:markora /opt/markora-migration/node_modules /opt/markora/migration/node_modules
COPY --chown=markora:markora infra/docker/runtime-package.json /opt/markora/package.json
COPY --chown=markora:markora infra/docker/check-runtime-layout.mjs /opt/markora/check-runtime-layout.mjs
RUN ln -s /opt/markora/api/node_modules /opt/markora/worker/node_modules \
    && chown -h markora:markora /opt/markora/worker/node_modules \
    && node /opt/markora/check-runtime-layout.mjs /opt/markora
USER markora

CMD ["node", "/opt/markora/api/dist/main.js"]
