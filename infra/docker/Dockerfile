FROM node:24.11.1-alpine@sha256:b3c2a6ebd4b9b3d1a3f8a58252c07b680e442e61ce1306ebdbc408ddf27cec14 AS build

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24.11.1-alpine@sha256:b3c2a6ebd4b9b3d1a3f8a58252c07b680e442e61ce1306ebdbc408ddf27cec14 AS runtime

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
