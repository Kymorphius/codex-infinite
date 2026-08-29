# Development process

## Change classes

### Small fix

A local correction that does not change a public contract, persistence, permissions, navigation model, or more than one responsibility. It needs a regression test or reproducible verification, but no standalone spec.

### Product change

Any new capability, changed user workflow, new endpoint, new persisted field, new device integration, or cross-module refactor. It starts with a spec copied from `docs/specs/template.md`.

### Architectural decision

A durable choice that is expensive to reverse: framework adoption, storage format, remote-node protocol, trust boundary, module system, or deployment topology. It also needs an ADR copied from `docs/adr/template.md`.

## Spec-driven loop

1. **Specify** — define the problem, non-goals, user flow, contracts, risks, and measurable acceptance criteria.
2. **Design** — identify ownership, dependency direction, migration, and rollback. Create an ADR if the choice is durable.
3. **Implement** — deliver the smallest vertical slice. Do not mix unrelated cleanup into the same change.
4. **Verify** — run unit/integration tests, structure checks, and proportional real-UI validation.
5. **Reconcile** — update the spec with deviations and mark its final status. A spec describes what actually shipped.

## Definition of done

- Acceptance criteria are satisfied and mapped to evidence.
- New behavior has tests at the lowest useful layer.
- UI changes are checked in the real embedded Codex surface.
- Security and data boundaries remain explicit.
- `npm run check` and `npm test` pass.
- Documentation and the spec reflect the shipped behavior.
- No structural budget was increased to accommodate implementation growth.

## Review checklist

- Is the responsibility owned by exactly one module?
- Does domain logic remain independent from transports and UI?
- Are errors truthful rather than replaced with fabricated success states?
- Are mutations origin-protected and bounded?
- Can the change be rolled back without corrupting runtime state?
- Did a large file grow when a focused extraction was possible?
