# 0003: Sign every owner-node mutation

- Status: accepted
- Date: 2026-08-30
- Deciders: Codex Control Console
- Related specs: `docs/specs/2026-08-30-federated-remote-messaging.md`

## Context

SSH authenticates direct peer access, but the relay path terminates SSH on routing infrastructure before reaching an owner's loopback-forwarded dashboard. Browser Origin checks cannot authenticate a server-to-server request, and putting prompts or credentials in command arguments would expose them to process inspection. Retrying a mutation after a lost response can also execute it twice.

## Decision

All owner-node mutations use an application-layer HMAC-SHA256 signature over method, exact path, timestamp, nonce, and body hash. Owner keys and per-peer copies live in separate mode-0600 files. Signatures have a 30-second validity window and owner processes retain recent nonces to reject replay. Adaptive transport retries reuse the same nonce, so an uncertain retry is acknowledged without repeating the action.

The browser authenticates only to its local loopback dashboard through exact Origin. The local server signs and routes the owner request. JSON bodies travel through SSH/curl stdin, never URLs or process arguments. The owner executes actions only against locally resolved native tasks.

## Alternatives considered

- Trust SSH alone: insufficient for a relay-terminated path and provides no application replay semantics.
- Put a bearer token in the URL or peer JSON: rejected because URLs, process arguments, browser state, and general peer configuration are observable beyond the credential boundary.
- Copy session files and write locally: rejected because it creates two native writers.
- Persist a central action queue: deferred because the relay must remain transport rather than authority.

## Consequences

Every node needs one owner key and one copy of each peer owner's key. Key rotation requires distributing the new owner key to trusted peers. Process restart clears replay memory, but the short validity window bounds exposure; durable idempotency may be added with a protected owner action journal if offline queues are introduced later.

