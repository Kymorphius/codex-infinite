# 0001: Federated full nodes through an authenticated relay

- Status: accepted
- Date: 2026-08-30
- Deciders: Codex Control Console
- Related specs: `docs/specs/2026-08-30-federated-codex-nodes.md`

## Context

Every participating device must retain a complete native Codex UI and complete control console. Nodes need cross-device visibility without creating a central owner, exposing session files over the LAN, weakening loopback-only application listeners, or requiring peers to be on the same reachable network. Future interaction routing must preserve the device that owns each native conversation.

## Decision

Use a peer federation model with a transport-provider boundary. Every node runs the same application and has a stable identity. It exports a bounded local-only snapshot from its existing loopback dashboard. The aggregate view combines only directly configured node snapshots and never re-exports aggregate peer data.

The transport is adaptive and ordered per peer. Direct SSH is preferred whenever reachable. If it fails, the node automatically falls back to an authenticated relay so peers only require outbound connectivity. The first relay provider uses SSH reverse tunnels: each node maps its loopback dashboard to a distinct loopback-only port on `67.230.169.158:33699`, and peers read that port through authenticated SSH. Future streaming relay transports may replace SSH without changing node, session, or ownership contracts.

Peer identities come from trusted local configuration, not remote payloads. Future chat mirroring and interaction commands will route to the owning node over separately specified versioned contracts.

## Alternatives considered

- Central control server: rejected because it makes one device authoritative and conflicts with equal full nodes.
- Lightweight remote agents: rejected because each device must have the complete native wrapper and UI.
- Mandatory direct SSH: rejected because peers may be behind NAT, move between networks, or be offline independently.
- Public relay HTTP/WebSocket listeners in the first rollout: deferred because it requires a new credential and TLS lifecycle; the transport boundary permits it later.
- Shared filesystem or session replication: rejected because it obscures ownership, risks loops/conflicts, and copies native session data unnecessarily.
- Screen sharing: rejected because it mirrors pixels rather than normalized Codex conversation state and does not provide a durable multi-node product model.

## Consequences

All nodes remain operational in standalone mode, no node exposes a LAN application listener, and the relay is routing infrastructure rather than a session authority. SSH supplies host authentication, encryption, and an existing operational path. The relay needs one assigned loopback port per node and persistent outbound tunnels. Peer refresh has process-start overhead and is initially polling rather than streaming. Full live message mirroring and cross-node actions require follow-up contracts but can use the same owning-node identity and transport boundary.

## Supersedes / superseded by

None.
