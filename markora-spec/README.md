# Markora V1 — Implementation Specification Suite

Status: **FROZEN FOR V1 IMPLEMENTATION**  
Spec version: `1.0.0`  
Decision cutoff: `2026-08-12`  
Audience: Product, design, frontend, backend, QA, Coding Agents

## 1. Authority and precedence

This directory is the V1 source of truth. When documents differ, use this order:

1. `00_SOURCE_OF_TRUTH.md` — frozen scope, invariants, definitions, precedence.
2. `06_IMPLEMENTATION_CONTRACT.md` — normative cross-layer behavior.
3. `07_ACCEPTANCE_MATRIX.md` — observable release gates.
4. `03_ARCHITECTURE_SPEC.md` and `04_API_DATA_CONTRACT.md` — technical realization.
5. `05_UX_SPEC.md` — interaction and visual behavior.
6. `01_PRODUCT_SPEC.md` — intent and user outcomes.
7. `08_TASK_GRAPH.md` — recommended implementation order, not product authority.

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative terms. A Coding Agent must not invent a product decision when the suite is silent; it must add an entry to `10_OPEN_QUESTIONS.md` and stop only the affected slice.

## 2. Deliverables

| File | Purpose |
|---|---|
| `00_SOURCE_OF_TRUTH.md` | Scope, invariants, vocabulary, frozen decisions |
| `01_PRODUCT_SPEC.md` | Users, jobs, capabilities, non-goals, product flows |
| `02_DOMAIN_DATA_SPEC.md` | Entities, states, constraints, lifecycle and transactions |
| `03_ARCHITECTURE_SPEC.md` | Modules, runtime, deployment, security, jobs, observability |
| `04_API_DATA_CONTRACT.md` | HTTP conventions, endpoints, payloads, errors, concurrency |
| `05_UX_SPEC.md` | UI shell, editor, search, tree/list, recovery, settings/admin |
| `06_IMPLEMENTATION_CONTRACT.md` | Rules every implementation layer must preserve |
| `07_ACCEPTANCE_MATRIX.md` | Traceable functional and non-functional acceptance tests |
| `08_TASK_GRAPH.md` | Implementation phases, dependencies, exit gates |
| `09_VERIFICATION_PROTOCOL.md` | Test strategy, fixtures, commands, release evidence |
| `10_OPEN_QUESTIONS.md` | Non-blocking tuning values and decision process |
| `11_SPEC_REVIEW_REPORT.md` | Consistency review, resolved conflicts and residual gates |
| `assets/ui-reference.png` | Approved visual direction, not a complete feature inventory |

## 3. Coding Agent operating rules

Before coding, read files `00` through `10` in order. Create a requirement-to-test map using the IDs in the acceptance matrix. Work in vertical slices, keep migrations forward-only, and update tests with each contract. Do not add excluded capabilities “for completeness.” Do not silently relax security, data integrity, or recovery behavior.

Definition of Done for V1 is: every `P0` and `P1` row in `07_ACCEPTANCE_MATRIX.md` passes, no unresolved P0 question exists, migration and rollback drills pass, and the UI is visually checked against `assets/ui-reference.png` at the specified viewport classes.
