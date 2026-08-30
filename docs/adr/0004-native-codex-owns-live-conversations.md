# ADR 0004: Native Codex owns live conversations

## Status

Accepted.

## Context

Remote messages were initially delivered with `codex exec resume`. That process writes the correct session history, but it temporarily becomes a second live owner. When the desktop application opens the conversation during execution it reports that the conversation is already open in another application and asks the user to retry.

The product requirement is stronger than durable history synchronization: every node must be able to continue a peer conversation while the owner node's native Codex interface remains authoritative and immediately viewable.

## Decision

The owner node's dedicated Codex desktop application is the only live writer for remotely continued conversations. Signed peer actions are delivered to the owner control service, which asks the existing loopback CDP adapter to open the native route and submit the prompt through the visible native composer.

The command-line resume dispatcher remains available for scheduled local dispatches, but it is not used for federated interactive messages.

The UI adapter must fail closed when it cannot prove that it opened the requested conversation or cannot identify an enabled native composer and send control. It must not fall back silently to a second command-line writer.

An unsent draft in the selected owner conversation may be projected to an authenticated peer. Remote edits carry the revision that was read; the owner replaces the draft only if its current revision still matches. This keeps the native application authoritative without reducing remote control to a blocking warning.

## Consequences

- The owner native application can display the conversation before, during, and after remote continuation without an ownership conflict.
- Remote interactive messaging requires the owner Codex desktop application and its loopback CDP connection to be healthy.
- Native DOM integration is isolated behind an adapter and covered by contract tests because native markup can change between Codex releases.
