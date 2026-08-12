# Markora V1 release gate

Run from a clean checkout with Node 24.11.1, pnpm 10.28.2, Docker Compose v2 and real PostgreSQL:

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod --audit-level high
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm test:integration
pnpm benchmark:release
```

Validate deployment assets before a release:

```powershell
$env:PUBLIC_ORIGIN = "https://markora.example"
$env:POSTGRES_PASSWORD = "validation-only-password"
$env:SESSION_SECRET = "validation-only-secret-at-least-32-characters"
docker compose -f infra/docker/compose.yaml config --quiet
docker run --rm -e MARKORA_SITE_ADDRESS=http://localhost `
  -v "${PWD}/infra/reverse-proxy/Caddyfile:/etc/caddy/Caddyfile:ro" `
  caddy:2.10.2-alpine@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83 `
  caddy validate --config /etc/caddy/Caddyfile
```

The release benchmark is destructive only inside a URL containing `markora_test`. It creates and
removes a dedicated benchmark workspace and records target hardware, p50/p95/p99 latency, 10k
folders/documents, 20 concurrent saves, 1,000 jobs and real 300-document import/export passes.
Budgets are executable assertions; do not relax them without a new recorded decision.

Browser release acceptance uses real Chromium and captures desktop 1600x900, tablet 1024x768 and
mobile 390x844 in both themes. It covers populated/empty/loading/error, Source/WYSIWYG/Split,
offline/conflict/local-draft, Trash/version, import/job progress, Settings and Admin. Run automated
accessibility checks first, then keyboard-only focus containment/return and 200% reflow review.
Generated screenshots stay under ignored `output/playwright`; acceptance JSON records the exact
journey and artifact path.

The release dependency gate has no known production dependency advisory. The RC upgraded Multer to
2.2.0 after the audit identified four upload-path denial-of-service advisories and yauzl to 3.4.0
after an archive-parser advisory; rerun the audit immediately before tagging because advisory state
changes independently of source.
