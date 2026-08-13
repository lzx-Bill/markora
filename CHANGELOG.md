# Changelog

All notable changes to Markora are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses Semantic Versioning.

## [Unreleased]

### Planned

- Complete public release-candidate hardening and GitHub distribution.

## [0.1.0-rc.1] - 2026-08-13

### Added

- Multi-user Markdown workspace with nested folders and stable document routes.
- WYSIWYG, Source, and Split editing with safe Markdown preservation.
- Revision conflicts, local emergency drafts, immutable versions, and Trash recovery.
- PostgreSQL hybrid English/CJK search, Quick Open, and command palette.
- Durable import, export, permanent-deletion, cleanup, and retention jobs.
- Personal settings, session management, administration, audit, and system health.
- Production Docker Compose topology, TLS proxy, migrations, backup, restore, and release gates.

### Security

- Workspace-scoped authorization, Argon2id credentials, revocable sessions, CSRF protection, Markdown
  sanitization, archive defenses, expiring download grants, and content-free structured audit logs.

[Unreleased]: https://github.com/lzx-Bill/markora/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/lzx-Bill/markora/releases/tag/v0.1.0-rc.1
