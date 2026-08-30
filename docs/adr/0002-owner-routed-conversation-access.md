# 0002: Route conversation access to the owning node

- Status: accepted
- Date: 2026-08-30
- Deciders: Codex Control Console
- Related specs: `docs/specs/2026-08-30-federated-conversation-activity.md`

## Context

Native conversation identifiers and files belong to the node running that Codex instance. Federation needs to expose useful live state without copying ownership, assuming globally unique identifiers, or turning the dashboard into a second chat system. Later remote mutations will need a stronger authorization boundary than browser-origin checks alone.

## Decision

Every cross-node conversation request includes both the configured owner node id and native thread id. The receiving console routes it to exactly one configured owner adapter. Owners export only versioned, bounded, normalized contracts from their loopback dashboard; aggregate data is never re-exported.

Read-only activity uses authenticated SSH transport and fixed owner-loopback HTTP routes. Mirrored activity remains ephemeral and is never persisted by the requesting node. Remote mutations are deferred to a separate versioned action protocol using short-lived signed requests, replay protection, and owner-side execution; long-lived secrets must remain in mode-0600 files and never enter browser state, URLs, process arguments, or logs.

## Alternatives considered

- Copy session files between nodes: rejected because it duplicates sensitive native state and blurs ownership.
- Open the remote identifier in the local Codex UI: rejected because the local app does not own that conversation.
- Treat thread ids as globally unique: rejected because identity must remain correct even after restores, clones, or imported data.
- Put SSH credentials or signing keys in browser code: rejected because credentials must remain server-side.

## Consequences

UI requests carry an explicit device id, provider adapters own transport selection, and node routes stay local-only. Read views can ship independently of mutation authorization. A remote outage affects only that owner view. Future actions require additional key lifecycle and replay-state implementation before they can be enabled.

