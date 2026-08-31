# 0007: Use owner-issued capabilities for remote approval responses

- Status: accepted
- Date: 2026-08-31
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-08-31-remote-approval-bridge.md`

## Context

App Server approval is a server-to-client request whose JSON-RPC id exists only
on a live desktop connection. Rollout history is insufficient for responding.
Exposing raw request ids and arbitrary response payloads across nodes would
expand the mutation surface and allow a browser to request permissions that the
owner never proposed. DOM-button automation would couple correctness to labels
and layout.

## Decision

The complete Codex desktop on the owner node passively captures supported
approval requests while retaining its native handler. It issues a random,
memory-only capability token for a redacted projection. Remote clients may
return only that token, its exact turn id, and a bounded one-turn decision.

The owner bridge resolves the token to the original request and derives the
protocol response from owner-held data. Raw JSON-RPC ids and permission objects
never cross the node boundary. App Server's request-resolution notification is
the shared completion signal for native and remote surfaces.

Persistent decisions, policy amendments, and arbitrary request methods remain
unavailable until separately specified and reviewed.

## Alternatives considered

- Reconstruct approval ids from rollout files: rejected because the actionable
  identifier and pending lifecycle are not present.
- Expose raw request ids and protocol responses: rejected because it delegates
  too much authority to the browser and transport caller.
- Click native approval buttons by label: rejected as the primary mechanism
  because localization and layout changes can select the wrong action.
- Run a standalone App Server client as the approval owner: rejected because it
  would compete with the full desktop runtime required by ADR 0006.

## Consequences

Remote approval is available only while the owner renderer and request token are
alive. A renderer restart falls back to the native prompt. Initial support is
deliberately limited to accept-once and decline, but the transport and UI remain
extensible through new reviewed action variants rather than arbitrary payloads.

## Supersedes / superseded by

Extends ADR 0003, ADR 0004, and ADR 0006; supersedes none.
