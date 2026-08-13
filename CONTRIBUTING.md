# Contributing to Markora

Thank you for helping improve Markora. Changes should preserve its core promises: canonical Markdown,
recoverable edits, workspace isolation, and a self-hosting path that can be reproduced from the repository.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before starting a large feature, schema change, or product-behavior change.
- Read [`markora-spec/00_SOURCE_OF_TRUTH.md`](markora-spec/00_SOURCE_OF_TRUTH.md). Product decisions
  belong in the specification or an ADR, not only in implementation code.
- Never include real user content, credentials, database dumps, or private logs in an issue or fixture.

## Local setup

You need Node.js 24.11.1, pnpm 10.28.2, Docker, and Docker Compose v2.

```bash
cp .env.example .env
docker compose -f infra/docker/compose.postgres.yaml up -d --wait
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Replace the example secrets in `.env` before running Markora in any shared environment.

## Quality gates

Run the source gates before submitting a pull request:

```bash
pnpm verify
```

Changes to persistence, authorization, search, jobs, or portability must also pass real PostgreSQL tests:

```bash
DATABASE_URL=postgresql://markora:markora@localhost:27185/markora_test?schema=public pnpm db:migrate
DATABASE_URL=postgresql://markora:markora@localhost:27185/markora_test?schema=public pnpm test:integration
```

Performance-sensitive changes should run `pnpm benchmark:release` against the disposable test database.
Do not relax a release budget without a recorded, evidence-backed decision.

## Pull requests

- Keep each pull request focused and explain the user-visible outcome.
- Add or update tests for changed behavior.
- Update API contracts, migrations, operations docs, and acceptance evidence when applicable.
- Use clear commit messages such as `feat(web): add outline navigation` or
  `fix(search): preserve workspace-scoped index lookup`.
- Confirm that `git diff --check` and `pnpm verify` pass.

By contributing, you agree that your contribution is licensed under the repository's AGPL-3.0 license.
