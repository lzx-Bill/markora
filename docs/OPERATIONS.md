# Markora V1 operations

## Production topology and prerequisites

Use Docker Engine 28+ with Compose v2, a host with durable local volumes, DNS pointing at the
host and TCP 80/443 available. `infra/docker/compose.yaml` starts one pinned application image as
Migration, API, Web and Worker processes, plus pinned Caddy and PostgreSQL images. Only Caddy has
host ports. PostgreSQL and internal ports 27183/27184 exist only on the private `backend` network;
there is no Redis.

Copy `infra/docker/production.env.example` to a secret-managed file outside the repository. Set an
HTTPS `PUBLIC_ORIGIN`, the same hostname in `MARKORA_SITE_ADDRESS`, a random database password and
an independent `SESSION_SECRET` of at least 32 characters. Restrict the file to the deployment
account. Caddy obtains/renews public certificates when a real hostname is used; if TLS terminates
at an upstream load balancer, preserve `X-Forwarded-Proto=https` and use a private trusted hop.

## Clean install and bootstrap

```sh
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml build
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml up -d --wait
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml ps
curl --fail https://markora.example.com/api/v1/health/live
curl --fail https://markora.example.com/api/v1/health/ready
```

The one-shot `migrate` service must finish successfully before API or Worker starts. Readiness
requires PostgreSQL connectivity, the current migration marker, and no unfinished migration. An
invalid secret/config fails process startup; an incompatible database returns 503 with a safe,
actionable migration error and must not receive traffic.

Create the first admin exactly once, then remove bootstrap values from the environment and shell
history:

```sh
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml run --rm \
  -e BOOTSTRAP_ADMIN_USERNAME=admin \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
  -e BOOTSTRAP_ADMIN_DISPLAY_NAME=Administrator \
  -e BOOTSTRAP_ADMIN_PASSWORD='use-a-temporary-secret' \
  api pnpm bootstrap:admin
```

The first login forces a password change. The bootstrap command refuses to run after any user
exists. Do not put bootstrap credentials in the persistent Compose environment.

## Health, logs and support correlation

`/api/v1/health/live` checks only API process life. `/api/v1/health/ready` checks PostgreSQL and
migration compatibility. Admin System Health additionally reports PostgreSQL, migration count and
fresh Worker heartbeat. HTTP completion logs are one JSON object per line with service, route,
method, status, duration, request ID and safe actor ID. API error bodies and `X-Request-ID` expose
the same support identifier; jobs use durable job IDs. Logs and audits exclude Markdown, tokens,
passwords, archive bytes and secret config.

## Backup and verified restore

Schedule encrypted, off-host copies of `/backups/*.dump` and their `.sha256` files. Choose backup
retention separately from Trash/version retention: permanently deleted content can remain in old
backups until those backups expire.

```sh
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml exec -T postgres \
  sh /opt/markora/scripts/backup.sh /backups/markora-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Every restore rehearsal targets a new isolated database and validates checksum/archive structure
before replacing anything:

```sh
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml exec -T postgres \
  sh /opt/markora/scripts/restore.sh /backups/markora-YYYYmmddTHHMMSSZ.dump markora_restore_drill
docker compose --env-file /secure/markora.env -f infra/docker/compose.yaml exec -T postgres \
  psql -U markora -d markora_restore_drill -c 'select count(*) from users;'
```

Never restore over the live database while application processes are running. The script refuses
an in-place restore unless an explicit destructive acknowledgement is supplied. A real incident
restore uses a maintenance window: stop API/Worker, restore to a new database, run current
migrations, verify counts/checksums and ownership smoke tests, then switch `DATABASE_URL`.

## Upgrade and rollback

1. Read release notes and confirm expand/migrate/contract compatibility.
2. Produce and verify a fresh backup/restore rehearsal.
3. Pull/build the immutable new image without changing the running stack.
4. Run `docker compose ... run --rm migrate`; stop if it fails.
5. Recreate API, Worker, Web and Proxy; wait for readiness and inspect JSON logs/Admin Health.
6. Run login, ownership, open/save, search and one background-job smoke test.

Application rollback means redeploying the previous compatible image. Never reverse a destructive
migration blindly. If a migration is not backward compatible, keep traffic stopped and restore the
verified pre-upgrade backup into a new database according to the recovery procedure.

## Worker restart, jobs and temporary files

Worker is safe to restart. Claimed jobs use leases/checkpoints; an expired lease is reclaimed and
successful items are not duplicated. Test this after infrastructure changes with
`docker compose ... restart worker`, then verify the same job ID reaches a valid terminal state.
Admin Jobs exposes only valid Cancel/Retry actions and safe error/request IDs.

`markora-temp` stores private import/export workspaces, not official content. The Worker removes
expired uploads/plans/artifacts and old unreferenced server-generated paths. Monitor volume usage;
do not back it up, expose it through the proxy or manually place user filenames beneath it.

## Emergency drafts and incident limits

PostgreSQL remains the official content store. IndexedDB protects only unsynchronized Markdown for
the currently open document and is local to that browser profile. It is not a backup or full
offline replica. Clearing browser storage, switching devices or losing the profile can remove the
draft. During an API/DB incident, users should keep the existing document tab open and export/copy
the local draft before browser maintenance.
