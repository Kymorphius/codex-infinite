# Codex Control Console engineering rules

This repository is a long-lived product, not a disposable prototype.

## Delivery model

- Use spec-driven development for every feature that changes user behavior, data contracts, security boundaries, or more than one module.
- Create the spec in `docs/specs/` before implementation. Keep the spec updated when the design changes.
- Small isolated fixes may skip a spec, but must include a regression test or explicit verification evidence.
- Record durable, hard-to-reverse architectural decisions in `docs/adr/`.

## Architecture

- Keep the dependency direction described in `docs/architecture.md`.
- Keep domain logic independent from HTTP, filesystem, CDP, DOM, and process control.
- Put external-system behavior behind adapters. UI modules consume normalized data and must not know storage formats.
- `src/main.mjs` is the composition root. It wires modules; it does not contain product logic.
- Do not add new responsibilities to a file that is already listed as structural debt in `config/structure-budget.json`.

## File and change boundaries

- Run `npm run check` and `npm test` before handing off a change.
- New source or script files must stay within the automated structure budget. Split by responsibility before raising the limit.
- Do not raise a file budget merely to make a check pass. A budget change requires an ADR explaining why decomposition is worse.
- Prefer one module, one contract, and one focused test file per responsibility.
- Keep generated and runtime state out of source control.

## Safety

- Loopback-only networking, exact-origin mutation checks, credential isolation, read-only session indexing, and non-destructive Zotero behavior are product invariants.
- Any relaxation of a safety invariant requires a spec, an ADR, and dedicated tests.
