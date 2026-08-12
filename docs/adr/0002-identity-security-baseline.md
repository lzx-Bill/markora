# ADR 0002 — Identity and session security baseline

Status: Accepted
Date: 2026-08-12

## Decision

- Passwords use Argon2id with memory cost 65,536 KiB, time cost 3 and parallelism 1 by default.
- Browser sessions use 256-bit opaque random tokens in a Secure/HttpOnly/SameSite=Strict cookie.
- PostgreSQL stores only SHA-256 token hashes, revocation state and safe device summaries.
- Mutating browser requests require an exact `Origin` match with `PUBLIC_ORIGIN`.
- Login throttling fingerprints normalized identity and network values with HMAC-SHA-256.
- Bootstrap is a serialized command guarded by a PostgreSQL advisory transaction lock and is
  permanently unavailable after any user exists.

## Calibration evidence

On 2026-08-12, three default-parameter Argon2id hashes took 97 ms, 93 ms and 96 ms on an Intel Core
i9-13900HX development host. Deployments must rerun calibration on target production hardware and
record any parameter change without lowering the Argon2id security floor.

## Consequences

- The API never returns session tokens in JSON and audit/log metadata never contains credentials.
- Disabled users lose authorization immediately; session records are revoked on the next check.
- Same-origin proxy deployment is part of the authentication contract.
