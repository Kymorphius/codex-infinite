# ADR 0016: Peer-to-peer, explicit Codex Skill synchronization and control

- Status: accepted
- Date: 2026-09-04

## Context

The console is a federation of complete Codex nodes with no central authority. Personal Skills are directory trees that may contain executable scripts, while system Skills, plugins, and credentials have separate ownership and trust boundaries. Automatic last-writer-wins replication would make a compromised or stale peer capable of silently replacing executable workflows everywhere.

## Decision

Skill sharing remains peer-to-peer and user initiated. Each node publishes a bounded metadata catalog and exports only a specifically named personal Skill through its loopback API. The initiating node fetches one immutable hash-addressed package and sends it to selected target owners through the existing signed action channel.

Targets validate the package, compare the expected current hash, stage and verify the new tree, back up a replaced tree, and atomically promote the staged directory. There is no automatic conflict merge and no central replicated database. System Skills, plugin Skills, nested symlinks, and arbitrary paths are outside the contract. A top-level linked Skill can be a source because Codex supports that authoring pattern, but synchronization never replaces such a link on a target.

Repository Skills are discovered from working directories already present in the owning node's read-only task index. Their paths are represented externally by opaque hashes and resolved again for every operation. Synchronizing a repository Skill promotes the copied version to the target's `agents-user` scope; it never creates an unknown repository or modifies a checked-in source tree.

Enabled state is not stored in a console database. The console reads and updates Codex's native `[[skills.config]]` entries in the owning user's `config.toml`. Mutations are explicit, exact-path scoped, atomic, and require a Codex restart to affect new task contexts. This keeps Codex, its CLI, and the console on one source of truth.

## Consequences

- Any healthy node can coordinate sharing without becoming a permanent controller.
- Offline devices and older console versions degrade independently.
- Updates require an explicit user action but cannot silently destroy an unseen concurrent edit.
- Backups consume bounded user storage until manually removed.
- Plugin distribution remains the preferred path for broadly published Skills; this feature serves a user's trusted personal devices.
- Repository Skills remain project-owned at the source while still being reusable on another trusted device through an explicit scope promotion.
- The console must preserve unrelated TOML syntax and tell the user that a restart is required after toggling.
