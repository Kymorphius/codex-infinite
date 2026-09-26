# ADR 0024: Transfer project versions through Git objects

- Status: accepted for the bounded manual sync release
- Date: 2026-09-26

## Context

One-shot filesystem clones cannot safely update existing working directories.
Copying `.git` also transfers machine-specific configuration and hooks, and a
linked worktree's `.git` can reference another machine's path. Project code,
native conversation history and task execution ownership have different lifecycles.

## Decision

Synchronize explicitly selected, native-registered single-root Git checkouts
through verified Git bundles over the existing signed SSH-to-loopback boundary.
Each machine retains its own repository configuration, credentials, ignored
files, runtime state and native session authority. No new listening address or
authentication exception is introduced.

The first release updates an existing checkout only by fast-forward on the same
branch after both versions have been checked. An opaque one-shot preview token
binds those versions; failed or uncertain writes are never automatically replayed.
Destination readback is mandatory. No project identity is inferred from a name
or a raw remote URL. The selection is explicit on every operation until a separate
persistent mapping contract is delivered.

Git object staging is distinct from workspace changes. An expired/lost preview
requires a new check; the current destination commit is the recovery authority.
After a successful write whose acknowledgement was lost, another preview returns
the identical-commit result. This release does not carry a task owner transaction
and does not promise durable task handoff recovery.

## Consequences

This supports repeatable code updates in either direction while keeping node
configuration local. Unsupported Git forms and unsafe versions block rather than
silently dropping files. Ignored dependencies and platform runtime readiness need
their own preparation step. Conversation import and task ownership transfer must
be designed and validated independently before the UI may describe a task as
continued on another device. Multi-device parallel work needs isolated task
branches/checkouts and explicit integration instead of competing fast-forwards.
