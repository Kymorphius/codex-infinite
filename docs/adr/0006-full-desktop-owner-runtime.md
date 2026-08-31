# 0006: Preserve the full desktop app as every node's execution runtime

- Status: accepted
- Date: 2026-08-31
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-08-31-full-desktop-owner-runtime.md`

## Context

Codex desktop provides host capabilities such as Computer Use, plugins, Apps,
interactive approvals, and operating-system integration. App Server exposes a
large structured protocol, but protocol types alone do not guarantee that an
independent client supplies the desktop tool host, authorization UI, or every
first-party behavior. Replacing the desktop runtime with a standalone server
would risk silently reducing remote task capability.

## Decision

Every federated node runs the complete Codex desktop application, and the native
application on the owning device remains the execution authority for its
conversations. Cross-node interactive messages are submitted through that
owner's native composer. Computer Use, plugins, Apps, MCP, Skills, approvals,
and future desktop-hosted features remain delegated to the owner application.

App Server is an auxiliary structured data and control channel. It may provide
history, events, titles, project data, and supported standard operations, but it
must not become a second conversation writer or be treated as proof of desktop
feature parity.

Nodes advertise a bounded runtime contract that distinguishes execution
authority, host health, submission path, activity provider, and feature-routing
policy. Consumers fail closed for unsupported mutations and retain compatibility
with older nodes during rolling upgrades.

## Alternatives considered

- Standalone App Server as the remote runtime: rejected because desktop tool-host
  parity is not guaranteed.
- Reimplement Computer Use and every plugin in the console: rejected because it
  duplicates vendor behavior and would remain incomplete across releases.
- Copy remote conversations into the local native store: rejected because it
  creates competing owners and changes the execution machine.
- Pixel-only screen sharing: retained as a possible desktop interaction fallback,
  but insufficient as the primary structured federation model.

## Consequences

Remote execution requires the owner Codex desktop app to remain healthy. The
control console can provide one unified conversation surface while preserving
owner capabilities, but exact first-party UI behavior still requires either a
supported remote-control surface or remote-window presentation. App Server
integration must negotiate protocol versions and degrade per capability rather
than assume parity.

## Supersedes / superseded by

Extends ADR 0004; does not supersede it.

