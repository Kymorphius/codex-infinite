# Full desktop owner runtime

## Context

Federated messages already enter the owning node through its native Codex
composer, but the node contract describes every peer only as `remote-codex`.
The requesting UI therefore cannot distinguish a complete desktop-owned
conversation from a reduced background runner. That ambiguity is dangerous for
Computer Use, plugins, Apps, MCP, Skills, approvals, and future desktop-only
features.

App Server may provide structured conversation data and control operations, but
its protocol surface is not evidence that an independent client provides every
desktop-hosted tool. The product must preserve the complete Codex desktop app as
the execution authority on every node.

## Goals

- Make the owning native desktop runtime explicit in the versioned node contract.
- Probe whether the owner desktop host is actually reachable before advertising
  native-composer interaction.
- Continue submitting remote messages only through the owner's native composer.
- Present the execution authority truthfully in the requesting UI.
- Keep older schema-v1 nodes readable with an `unknown` runtime.
- Leave App Server available as a future auxiliary event/data provider without
  making it the execution owner.
- Overlay the owning desktop's live thread status on the read-only rollout index
  so native work in progress remains visible across nodes.

## Non-goals

- Reimplementing Computer Use or plugin execution in the control console.
- Claiming that a configured feature is installed or enabled on a node.
- Streaming the remote desktop window in this increment.
- Replacing polling activity projection with App Server events in this increment.

## Contract

Node snapshots advance to schema version 2 and include a bounded `runtime`
object:

- `authority`: `owner-native-desktop` or `unknown`.
- `health`: `connected`, `unavailable`, or `unknown`.
- `submission`: `native-composer` or `unavailable`.
- `activity`: `rollout-projection` or `unknown`.
- `featurePolicy`: `owner-native` or `unknown`.

These fields describe routing and ownership, not feature availability. In
particular, `owner-native` means Computer Use and plugins stay with the complete
owner application; it does not claim that either is installed or enabled.

Consumers accept schema versions 1 and 2. Schema-v1 nodes receive an `unknown`
runtime and remain usable during rolling upgrades.

## Safety invariants

- The owner native desktop remains the only interactive conversation writer.
- A failed native-host probe never falls back to a CLI or independent App Server
  writer.
- Peer identity remains configuration-owned.
- Runtime fields are allowlisted and bounded before entering browser state.
- Loopback listeners, signed mutations, replay protection, and credential
  isolation remain unchanged.

## Acceptance criteria

- [x] A healthy owner exports schema v2 with `owner-native-desktop` authority.
- [x] An unavailable desktop host exports an unavailable submission state.
- [x] Schema-v1 peers remain readable and are labelled with unknown runtime.
- [x] Successful remote submission reports native desktop execution authority.
- [x] The conversation UI distinguishes native owner execution from generic
  remote access without claiming feature installation.
- [x] Full structure and test checks pass.
- [x] A native `active` thread overrides a stale completed rollout status.
- [x] Native status normalization is bounded and malformed entries are ignored.
- [x] An unavailable desktop status bridge safely falls back to rollout status.
- [x] Writer locks are not treated as activity because they also cover loaded,
  idle native threads.
- [x] Current rollout phases distinguish in-progress commentary and tool work
  from a terminal final response.
