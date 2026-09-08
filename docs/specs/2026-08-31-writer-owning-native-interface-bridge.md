# Writer-owning native interface bridge

- Status: implemented and accepted on MacBook Pro; Windows Desktop rollout in progress
- Owner: Codex Control Console
- Date: 2026-08-31
- Related ADRs: `docs/adr/0003-signed-owner-actions.md`,
  `docs/adr/0004-native-codex-owns-live-conversations.md`,
  `docs/adr/0006-full-desktop-owner-runtime.md`,
  `docs/adr/0009-owner-issued-remote-thread-settings.md`,
  `docs/adr/0010-route-actions-to-the-writer-owning-desktop.md`

## Problem

Each Mac runs a complete primary ChatGPT desktop and a dedicated control-console
profile. Both profiles share durable Codex sessions, but each has its own App
Server process. A thread already loaded by the primary desktop has a single
native writer. Applying settings through the dedicated profile therefore fails
with `already has an active writer`, even though the console can read the
thread's rollout and display its real settings.

The user's requirement is to change that thread from another node while the
primary desktop remains the visible, authoritative interface. A second App
Server must not seize the writer or manufacture a local-only setting.

Official App Server documentation describes the protocol as the interface used
to power rich Codex clients and permits plain WebSocket connections only on
localhost or through an SSH port forward. It does not define a public writer
takeover mechanism. The control console must therefore route the action into
the desktop process that already owns the writer.

## Goals

- Identify the exact App Server process holding an allowlisted thread writer
  lock on macOS.
- Map that process through its ChatGPT parent to one configured loopback CDP
  endpoint.
- Install a minimal owner bridge into the primary desktop renderer when that
  endpoint is available, without installing the dashboard or changing native
  navigation.
- Apply model, reasoning, service tier, permission, and per-thread context
  changes through the writer-owning renderer's existing App Server bridge.
- Return success only after the writer-owning bridge accepts the exact change
  and the authoritative rollout projection observes it.
- Keep the current turn and visible native interface intact; settings apply to
  subsequent turns under the existing contract.
- Reuse the same routing primitive for message, interrupt, draft, and approval
  actions in later increments.
- Support the same writer-matched owner bridge on Windows after an explicit,
  idle-only relaunch of the ordinary ChatGPT desktop with loopback CDP.

## Non-goals

- Taking over a writer with a second App Server, CLI process, or copied profile.
- Editing rollout JSONL, state databases, writer-lock files, or native config to
  simulate success.
- Coordinate-based clicking, Apple Accessibility automation, screen streaming,
  or a general-purpose remote JavaScript execution endpoint.
- Exposing CDP or App Server listeners on a LAN or public interface.
- Automatically quitting or restarting the user's primary ChatGPT desktop.
- Restarting a primary desktop while any task is active.
- Automatically enabling or relaunching the Windows primary desktop during
  normal service startup.

## User experience

The existing five native-style controls remain unchanged. When the selected
thread is owned by the primary desktop, the owner node routes the change to that
desktop. The value updates in both the primary native interface and the remote
console after authoritative readback.

While applying, the footer reports that the owning native interface is being
updated. A successful response retains the existing `下轮生效` language. If
the primary owner bridge is not enabled, the old value remains visible and the
error explains that the owning ChatGPT interface must be launched with its
private control bridge. The console never falls back to the dedicated profile
when a different live writer is known.

Enabling the primary bridge is a separate explicit maintenance action. It must
first report any active owner task and refuse to restart unless the user has
confirmed the desktop is idle. The normal control service only attaches to an
already enabled primary endpoint; it never launches or quits that app itself.

## Contracts and data

The browser and signed peer setting payloads remain unchanged. The owner result
adds bounded routing metadata:

- `ownerSurface`: `primary-native` or `dedicated-native`;
- `ownerBridge`: `writer-matched` or `dormant-fallback`;
- `effectiveFrom`: `next-turn`.

These values are presentation metadata only and do not expose PIDs, filesystem
paths, CDP ports, lock names, internal App Server responses, or credentials.

The private node configuration adds:

- `CODEX_CONTROL_PRIMARY_CDP_HOST`, default `127.0.0.1`;
- `CODEX_CONTROL_PRIMARY_CDP_PORT`, default `9232`;
- `CODEX_CONTROL_PRIMARY_CDP_ENABLED`, default false.
- `CODEX_CONTROL_PRIMARY_PROFILE_DIR`, the ordinary desktop profile used only
  to distinguish it from the dedicated control-console profile.

The Windows scheduled-task launcher projects these private values from
`windows-node.json` into the service environment. A fresh installation writes
the fields with the bridge disabled; an explicit maintenance rollout changes
only `primaryCdpEnabled` after the ordinary desktop has been relaunched on the
matching loopback port.

The primary endpoint is never included in peer snapshots or browser responses.
No source-controlled or migrated application data is required.

## Design and ownership

- `src/native-writer-locator.mjs` owns macOS writer-lock holder discovery and
  maps only configured ChatGPT parent processes to normalized owner surfaces
  on macOS and Windows.
- `src/native-desktop-router.mjs` owns fail-closed selection between the primary
  owner bridge and the dedicated wrapper bridge.
- `src/native-owner-injector.mjs` installs only the allowlisted native bridge
  scripts into an already running primary CDP renderer.
- `src/native-thread-settings-adapter.mjs` consumes the router and remains
  responsible only for the bounded settings operation.
- `src/primary-owner-launch.mjs` provides read-only planning and an explicit
  maintenance relaunch operation; it is never called from normal service
  startup.
- `scripts/start-windows-primary-bridge.ps1` performs the Windows interactive
  launch only after explicit idle confirmation; it never stops an existing
  ordinary desktop and accepts only literal loopback.
- `src/main.mjs` wires configured endpoints and lifecycles without containing
  discovery or routing policy.

Writer discovery starts from the exact normalized UUID under
`$CODEX_HOME/thread-writer-locks`. It asks `lsof` which process holds the file,
walks a bounded parent chain, and accepts only a ChatGPT application command
whose CDP port exactly matches one of the configured loopback endpoints. If a
lock is held by an unknown process or a known primary process without a healthy
bridge, routing fails closed. If no process holds the lock, the existing
dedicated bridge remains the dormant-thread fallback.

The primary injector evaluates the same bounded App Server bridge contract used
by the dedicated profile, but does not inject console navigation, an iframe, or
dashboard compatibility flags. It reconnects after renderer replacement and
stays unavailable when the primary CDP endpoint is absent.

## Security and privacy

- Both CDP endpoints must use the literal loopback host. Configuration rejects
  wildcard, LAN, relay, and public hosts.
- Existing exact-Origin browser checks, signed owner actions, timestamp bounds,
  nonce replay protection, SSH host verification, and bounded bodies remain
  unchanged.
- Writer discovery accepts only UUID lock paths below the configured source
  Codex home and never accepts a path from browser or peer input.
- Process ids and commands remain adapter-internal and are omitted from logs and
  responses.
- The injected primary bridge exposes only fixed UUID-validated operations and
  allowlisted setting values. It is not an arbitrary evaluation API.
- The maintenance relaunch must use explicit executable and loopback arguments,
  must not terminate the dedicated profile, and must not run during an active
  native task.

## Rollout and rollback

Ship routing, discovery, injection, and tests with primary CDP disabled. The
dedicated profile continues existing behavior. On a node chosen for acceptance,
wait until the primary desktop is idle, explicitly relaunch only that primary
desktop with loopback CDP enabled, then enable its private configuration and
restart only the control service.

On Windows, preserve the ordinary packaged-app profile, relaunch only its root
ChatGPT process with port 9232 bound to literal loopback, set the private
runtime configuration to enabled, and restart the scheduled control task. The
dedicated profile on port 9231 is not stopped or modified.

Rollback disables the primary endpoint and restarts the control service. The
primary desktop can later be launched normally without CDP. No session, project,
context, or credential migration is reversed.

## Acceptance criteria

- [x] A primary-desktop-owned thread resolves to `primary-native`; the dedicated
  adapter is not called.
- [x] A dedicated-profile-owned thread resolves to `dedicated-native`.
- [x] A dormant thread uses the dedicated fallback and preserves current
  behavior.
- [x] A known external writer without a healthy primary bridge fails with a
  bounded setup message and never attempts a second writer.
- [x] Model, reasoning, speed, access, and context changes use the same validated
  contract on either owner surface.
- [x] The MacBook Pro native interface visibly reflects one reversible test
  change and the remote console reads back the same value.
- [x] The test value is restored and no active task, draft, or approval is lost.
- [x] CDP remains loopback-only and no owner internals enter HTTP responses.
- [x] `npm test`, `npm run check`, and `git diff --check` pass.
- [ ] The Windows Desktop ordinary interface accepts and visibly reflects one
  reversible reasoning-effort change through `primary-native`.

## Verification plan

- Unit: process/parent parsing, known endpoint matching, unknown writer failure,
  dormant fallback, bounded contracts, and primary-launch refusal while active.
- Integration: settings service routes through a mocked primary renderer and
  observes authoritative readback without touching the dedicated adapter.
- Real UI: route one setting through the MacBook Pro primary ChatGPT interface,
  confirm native and remote values, then restore it from the current primary
  development task.
- Structure and regression: full suite, structure budget, diff whitespace,
  loopback checks, and unchanged wrapper behavior.

## Shipped deviations

None. After `自动驾驶` became idle, the MacBook Pro primary desktop was
explicitly relaunched with its loopback-only bridge. A writer-matched request
changed reasoning effort from `medium` to `high` through `primary-native`, and a
second writer-matched request restored `medium`; both returned the owner-issued
202 confirmation without starting a turn.
