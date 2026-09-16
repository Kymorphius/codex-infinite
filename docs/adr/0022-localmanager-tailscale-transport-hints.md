# ADR 0022: LocalManager supplies bounded Tailscale transport hints

## Status

Accepted, 2026-09-17.

## Context

The peer federation contract treats `peers.json` as the trusted source of peer
identity and ordered authenticated transports. LocalManager separately owns a
private device directory that reconciles explicit registrations, Tailscale
observations, and management-service identity evidence. The two products need a
connection without making network discovery an authorization mechanism.

## Decision

Control Console reads LocalManager's on-disk device-directory snapshot through a
read-only adapter. A peer opts in with an exact LocalManager registration id or
an exact stable device-directory id. Registration ids require a registered
record. A device-directory id may select a discovered record only when it has a
persisted tailnet/node binding. For a non-conflicting match, the adapter may
insert one validated Tailscale IPv4 address as a direct SSH candidate. It copies SSH parameters from
the peer's existing trusted direct route and inserts the hint before relay
fallback. The static peer definition continues to own peer identity,
credentials, route ordering, and action authorization.

The integration deliberately does not call LocalManager's authenticated HTTP
API, copy its session token, match display names, auto-enrol discovered nodes,
rewrite either product's state, or infer service availability from Tailscale
online state. A failed directory read degrades to static peer configuration.

## Consequences

- Tailscale address changes are picked up on Control Console restart without
  duplicating them in source-controlled configuration.
- Each machine retains an independent LocalManager identity and directory.
- LocalManager discovery alone cannot create a Codex peer or grant SSH access.
- The initial contract accepts Tailscale IPv4 only. IPv6 can be added later when
  the peer host contract and SSH test matrix support literal IPv6 safely.
- Runtime SSH success, not directory metadata, remains the availability proof.
