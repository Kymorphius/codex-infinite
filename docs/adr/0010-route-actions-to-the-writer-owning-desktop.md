# ADR 0010: Route actions to the writer-owning desktop

## Status

Accepted on 2026-08-31.

## Context

A node may run a primary ChatGPT desktop and a dedicated control-console profile
against the same durable Codex home. The session store is shared, but App Server
writer ownership is process-local and exclusive. Sending a setting change to the
dedicated App Server when the primary App Server owns the thread produces an
active-writer rejection. Retrying, rewriting persisted data, or starting a CLI
resume would violate the single-writer invariant.

## Decision

Owner-routed actions are delivered to the desktop process that holds the exact
thread writer lock. On macOS, an infrastructure adapter resolves the lock holder,
walks its bounded process ancestry, and maps only configured ChatGPT processes to
loopback CDP endpoints. A minimal injected renderer bridge then invokes that
desktop's own App Server connection.

If a known writer cannot be mapped to a healthy configured bridge, the action
fails closed. It never falls back to another App Server. When no writer holds a
dormant thread, the dedicated desktop remains the load-and-resume fallback.

The primary desktop is never restarted by normal control-service startup. CDP is
enabled only through an explicit idle-time maintenance operation and binds only
to loopback. Process ids, commands, lock paths, ports, and native protocol bodies
remain private to the owner node.

## Consequences

- The native interface that visibly owns a thread is also the process applying
  its remote changes.
- Active-writer conflicts become a routing/setup condition rather than a reason
  to create a competing writer.
- Nodes need one additional private loopback CDP endpoint when their primary
  desktop should accept remote actions.
- Native UI availability is an explicit runtime capability; losing the primary
  bridge makes its active threads read-only until the bridge returns.
- macOS process and lock discovery stays behind an adapter so other platforms
  can provide a different implementation later.
