# Markora development

## Prerequisites

- Node.js `24.11.1`
- pnpm `10.28.2`
- Docker with Compose v2

## Install

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
```

Replace the example session secret before using any shared or production-like environment.

## PostgreSQL and migrations

```powershell
docker compose -f infra/docker/compose.postgres.yaml up -d --wait
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora?schema=public"
pnpm db:migrate
```

The development Compose file binds PostgreSQL only to loopback. Production topology and reverse
proxy hardening are completed in Phase 8; PostgreSQL must not expose a production host port.

## Run

Set the values from `.env.example` in the current shell or load them with your preferred secret-safe
development environment, then run:

```powershell
pnpm dev
```

The Web process uses port `27183`; the API uses `27184`; the Worker has no public port.

## One-time bootstrap admin

Fill the `BOOTSTRAP_ADMIN_*` values in `.env`, then run:

```powershell
pnpm bootstrap:admin
```

The command succeeds only while the users table is empty. It creates exactly one admin and one
workspace, stores only an Argon2id password hash, and forces a password change on first login.

## Integration database

Fresh development Compose volumes create `markora_test` automatically. Migrate and test it without
touching local development data:

```powershell
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm db:migrate
pnpm test:integration
```

## Verify

```powershell
pnpm verify
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm test:integration
```

`pnpm verify` covers formatting/lint, type checking, unit/component tests, OpenAPI drift, Prisma
schema validation and production builds. Integration tests always target real PostgreSQL.
