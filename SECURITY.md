# Security policy

## Supported versions

Markora is currently in release-candidate development. Security fixes are applied to the latest published
release only. Upgrade guidance and breaking changes are documented in [`CHANGELOG.md`](CHANGELOG.md).

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** feature for this repository. Do not open a public
issue, discussion, or pull request containing exploit details, credentials, private content, or logs.

Include:

- the affected version or commit;
- the vulnerable component and required preconditions;
- reproduction steps or a minimal proof of concept;
- likely impact and any known mitigation.

You should receive an acknowledgement within seven days. We will validate the report, coordinate a fix
and disclosure window, and credit reporters who want attribution. If private vulnerability reporting is
temporarily unavailable, contact the maintainer through their GitHub profile without sending sensitive
details publicly.

## Scope

The highest-priority areas are authentication, workspace isolation, unsafe Markdown rendering, import ZIP
handling, download authorization, session/token exposure, privilege escalation, and destructive job safety.
Reports that require already-compromised host/root access or unsupported deployment changes may be out of
scope, but responsible reports are still welcome.
