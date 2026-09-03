FROM node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS build

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runtime

ENV NODE_ENV=production \
    MARKORA_ROOT=/opt/markora
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2 \
    && addgroup --system --gid 10001 markora \
    && adduser --system --uid 10001 --ingroup markora markora \
    && mkdir -p /var/lib/markora/tmp \
    && chown -R markora:markora /var/lib/markora /opt/markora
COPY --from=build --chown=markora:markora /opt/markora /opt/markora
USER markora

CMD ["pnpm", "--filter", "@markora/api", "start"]
