FROM node:26.0.0-alpine@sha256:30f5a66e7265ef70aac56b4753ffa7905e54eca1084bc25503893ad8e9273f05 AS build

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
WORKDIR /opt/markora
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:26.0.0-alpine@sha256:30f5a66e7265ef70aac56b4753ffa7905e54eca1084bc25503893ad8e9273f05 AS runtime

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
