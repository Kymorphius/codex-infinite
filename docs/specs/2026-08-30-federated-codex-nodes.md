# Federated full Codex nodes

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: `docs/adr/0001-federated-nodes-through-relay.md`

## Problem

The console currently represents only one Mac. The desired product is not a central controller with lightweight agents: every device must run the complete wrapper, dashboard, and native Codex UI, while every peer can see which native conversations exist and which are active on the other devices.

The first target peer is the Mac at `192.168.1.30`, named “森林 Mac”. It already runs native ChatGPT/Codex and has 1,095 session files, but does not currently have a Node.js runtime or this wrapper installed.

## Goals

- Run the same complete Codex Control Console distribution on every Mac node.
- Give each node a stable identity and display local and remote native sessions under their owning devices.
- Fetch only the owning node's bounded local snapshot, avoiding federation loops and duplicate re-export.
- Keep dashboard and CDP listeners on loopback; support peers that cannot directly reach each other by routing through an authenticated relay.
- Preserve native Codex as the owner of conversations and interaction state.

## Non-goals

- No central authority, primary node, database replication, screen sharing, or replacement chat UI.
- This phase does not mirror full message bodies or stream token-by-token assistant output.
- This phase does not send prompts or request remote native navigation; those actions will build on the owning-device routing contract in a follow-up spec.
- No listener binds to a LAN or wildcard address.

## User experience

Each node's existing “会话中心” keeps the device → working directory → native conversation hierarchy. A peer appears as another device card with its own name, location, connection state, projects, conversations, and current activity status. A failed peer remains visible as disconnected/error without hiding healthy local data.

Refresh fetches local data and configured peers concurrently. Remote conversation actions are disabled until the follow-up routed-action protocol ships; the UI must not pretend that a remote conversation can be opened in the local native app.

## Contracts and data

`~/.codex-control-console/peers.json` is a user-owned configuration file with mode 0600. Each peer has ordered transport candidates. Direct SSH is attempted first and the existing relay at `67.230.169.158:33699` is the fallback:

```json
{
  "peers": [
    {
      "id": "forest-mac",
      "name": "森林 Mac",
      "location": "森林",
      "transports": [
        {
          "type": "direct-ssh",
          "host": "192.168.1.30",
          "user": "matrix",
          "port": 22,
          "dashboardPort": 47831
        },
        {
          "type": "ssh-relay",
          "relayHost": "67.230.169.158",
          "relayUser": "root",
          "relayPort": 33699,
          "forwardedPort": 47842
        }
      ]
    }
  ]
}
```

Every node exposes `GET|HEAD /api/node/snapshot` on its loopback dashboard. The response is schema version 1 and contains only that node's normalized, bounded local session summary. It excludes source file paths and never includes data learned from peers.

Each node maintains an outbound reverse tunnel from an assigned loopback-only port on the relay to its local dashboard. The peer adapter tries configured transports in order on every refresh: direct SSH first, then the relay. It invokes a fixed snapshot request through `ssh`, using argument arrays, strict host-key checking, batch authentication, bounded connection time, and bounded output. Configurable values are validated before becoming SSH arguments. Transport failure is isolated and the successful transport is reported as operational evidence, not as conversation identity.

## Design and ownership

- `src/peer-contract.mjs` owns peer-definition validation, snapshot projection, and untrusted snapshot normalization.
- `src/peer-config.mjs` owns the 0600 peer configuration file and safe empty defaults.
- `src/ssh-peer-adapter.mjs` owns the transport-provider boundary, ordered direct/relay SSH invocation, and peer snapshot collection.
- `src/federated-task-adapter.mjs` combines the local adapter with peer adapters and recomputes the aggregate project view.
- `src/task-adapter.mjs` remains the local filesystem adapter.
- `src/tasks-http.mjs` serves both aggregate `/api/tasks` and local-only `/api/node/snapshot` contracts.
- `src/main.mjs` composes local identity, local adapter, peer adapters, and the federated adapter.

Domain normalization remains independent from SSH, HTTP, and filesystem behavior. The web UI continues consuming normalized task/device data.

## Security and privacy

- Dashboard and CDP remain bound to `127.0.0.1`; the relay's forwarded ports also bind only to its loopback interface.
- Nodes make outbound SSH connections to the relay; peer devices need no direct network reachability.
- Host keys must already be trusted. Password prompts and interactive authentication are disabled.
- Peer config contains no private keys or passwords and is readable only by the current user.
- Snapshot projection drops `sourceFile` and unknown fields; a peer cannot override its configured identity.
- Commands are fixed and launched without a shell. Peer host, user, ports, and identifiers use strict allowlists.
- Sessions remain read-only. No remote mutation is introduced in this phase.

## Rollout and rollback

Federation is inactive when the peer file is absent or empty, preserving current single-node behavior. Removing or renaming the peer file returns a node to standalone operation. A failed peer cannot prevent the local node from starting or serving its own sessions.

Forest deployment installs a user-local Node runtime, checks out/copies the same committed application, creates its node/peer config with mode 0600, launches the full wrapper as a user service, and maintains its assigned reverse tunnel. The current Mac receives the symmetric setup. Rollback unloads only those user services and removes the deployed application/runtime directories; native ChatGPT/Codex data remains untouched.

## Acceptance criteria

- [x] Standalone behavior and all current tests remain unchanged without peer configuration.
- [x] The local-only snapshot never contains peer data or source paths.
- [x] Invalid peer definitions and malformed/unbounded snapshots fail closed.
- [x] Peer failure is visible but does not take down healthy local data.
- [x] Both Macs run the full wrapper and show both node cards with truthful session counts.
- [x] Both nodes have a verified relay path independent of direct peer reachability.
- [x] All application and relay-forward listeners remain loopback-only and SSH host-key/authentication checks are enforced.

## Verification plan

- Unit: peer validation, snapshot projection/normalization, aggregate status, collision behavior, and failure isolation.
- Integration: node snapshot HTTP behavior, provider routing, and mocked SSH invocation arguments/output bounds.
- Real UI: start both full nodes and reverse tunnels, verify two device cards from both directions, inspect node and relay listener addresses, and compare remote counts with the owner node.
- Structure and regression: `npm run check`, `npm test`, and read-only inspect on both nodes.

## Shipped deviations

- The accepted design was extended before implementation from relay-preferred to adaptive ordered transport: direct SSH is retried first on each refresh, then `67.230.169.158:33699` relay forwarding is used.
- Both nodes run persistent complete wrapper and relay LaunchAgents. Forest uses the checksum-verified official Node.js 22.23.2 Apple Silicon user runtime and its existing native ChatGPT/Codex installation.
- Each node returned 320 aggregate sessions: 160 owned locally plus 160 from its peer, grouped into 2 devices and 31 working directories. Real embedded inspection verified both native windows and all four injected entries exactly once.
- Relay loopback ports 47841 and 47842 independently returned schema-v1 snapshots for MatrixBook Air and Forest Mac respectively, each with 160 tasks. No application or forwarded port bound to a LAN/public address.
- The browser silently refreshes node snapshots every 15 seconds. Unavailable peer cards remain visible, and remote-native open, context, and dispatch actions remain disabled until the routed-action protocol ships.
- Final structure validation covered 100 files with zero frozen debt; all 93 tests passed independently on both Macs after the final synchronization changes.
