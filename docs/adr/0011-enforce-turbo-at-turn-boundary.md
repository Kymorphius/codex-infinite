# ADR 0011: Enforce Turbo at the native turn boundary

## Status

Accepted on 2026-08-31.

## Context

A global performance mode must affect native and remotely initiated turns on
multiple devices while preserving hundreds of independent conversation
preferences. Eagerly rewriting every thread is expensive, creates writer
contention, and cannot be reversed reliably when a thread changes while the
mode is enabled.

## Decision

Turbo is enforced at the writer-owning desktop's outgoing `turn/start`
boundary. The bridge clones and overrides only the turn request, using the
model catalog's highest supported effort and the turn-scoped Fast service tier.
It never writes sticky thread settings. Disabling the mode therefore exposes
the native UI's unchanged per-thread choices on the next turn and requires no
restoration request or lossy bulk rewrite.

The optional Turbo million-context preference is prepared at the same boundary
but cannot be encoded in `turn/start`: the installed protocol exposes context
configuration on `thread/resume`. The renderer therefore performs one bounded
resume immediately before the outgoing turn, using 1M while configured and the
thread's ordinary explicit override (or model default) when restoring. Turbo
does not write the persistent per-thread override store.

The switch is persisted per node and coordinated through the existing signed
peer-action channel. Primary and dedicated native renderers receive identical
policy snapshots. The browser never receives native protocol access.

The synchronized policy may preserve or select model, reasoning effort, Fast,
and a named access profile. An empty device-id list means all nodes; otherwise
each node derives a local `active` flag from the shared target list. Excluded
nodes retain the policy for consistent editing but do not transform turns.

## Consequences

- Direct native chat and unified remote chat behave identically.
- Existing and future threads are covered lazily without opening them in bulk.
- Active turns remain intact and only later turns see state changes.
- A disconnected node can temporarily diverge and must be reported as such.
- The bridge depends on the stable App Server `turn/start` contract and must be
  regression-tested against generated protocol schemas when Codex is upgraded.
