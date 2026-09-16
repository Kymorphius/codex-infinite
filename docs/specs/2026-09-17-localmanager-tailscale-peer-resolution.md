# LocalManager Tailscale peer resolution

## Status

Accepted for implementation on 2026-09-17.

## Problem

Control Console peers currently carry fixed LAN addresses and relay routes in
`peers.json`. LocalManager already maintains a private device directory with
stable registrations and observed Tailscale addresses. Keeping the same address
in two independent files makes remote access brittle when a device leaves the
LAN, but treating every discovered Tailscale node as a trusted Codex peer would
collapse discovery, identity, and service reachability into one unsafe signal.

## User outcome

A configured remote Codex peer can use the Tailscale IPv4 address held by its
explicit LocalManager registration. Existing LAN direct SSH remains first and
the relay remains the final fallback. A missing, stale, malformed, conflicting,
or unavailable LocalManager directory never prevents the local console from
starting and never removes statically configured routes.

## Contract

- A peer may declare `localManagerRegistrationId`. This is an exact identifier,
  not a display name, hostname, platform, or address match.
- The console reads LocalManager's private `device-directory.json` snapshot. The
  path is local configuration (`CODEX_CONTROL_LOCALMANAGER_DEVICE_DIRECTORY`),
  with platform defaults for the standard macOS and Windows installations.
- A directory record contributes a route only when it is registered, its
  registration id exactly matches the peer binding, and it has no identity
  conflict.
- Only IPv4 addresses in Tailscale's `100.64.0.0/10` range are accepted. The
  console does not turn LAN addresses or arbitrary discovered addresses into
  transports.
- The derived route reuses the SSH user, port, and dashboard port from the
  peer's first configured direct route. LocalManager contributes only the host
  hint; it contributes no credentials or execution authority.
- The route is inserted after configured direct routes and before relay routes,
  deduplicated by host, and bounded by the existing four-route peer limit.
- Online/discovered state is not reported as Codex availability. Existing SSH
  execution remains the reachability and service check.
- Runtime resolution does not rewrite `peers.json`, LocalManager state, or any
  device identity.

## Ownership

- `src/peer-contract.mjs` validates the optional explicit registration binding.
- `src/localmanager-peer-directory.mjs` is the read-only filesystem adapter and
  translates a valid LocalManager snapshot into bounded peer route hints.
- `src/config.mjs` owns the machine-local directory path.
- `src/main.mjs` composes the adapter before creating peer consumers.

## Failure and rollback

Missing files are a quiet no-op. Other read or validation failures emit one
bounded warning and retain the original peer definitions. Removing the optional
binding or clearing the configured directory path disables the integration;
the static LAN and relay configuration continues to work.

## Acceptance

- Exact registered bindings add only a Tailscale IPv4 direct route.
- Name-only, unregistered, identity-conflicted, non-Tailscale, duplicate, and
  future-format records add no route.
- The configured LAN route remains first and relay remains last.
- Missing or invalid directory data preserves all static peer routes.
- Configuration tests cover macOS, Windows, explicit override, and disablement.
- Repository checks and tests pass.
