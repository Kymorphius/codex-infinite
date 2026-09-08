# Cross-device Codex Skill sharing and control

- Status: implemented and deployed to all three configured nodes
- Owner: Codex Control Console
- Date: 2026-09-04
- Related ADRs: `docs/adr/0016-peer-to-peer-skill-sync.md`

## Problem

Every console node already discovers its peers and can route authenticated owner actions, but Skills remain isolated on each device. A user cannot see which personal Codex Skills exist elsewhere, compare versions, or deliberately copy a Skill to the other trusted devices.

## Goals

- Show the personal Skill inventory of every configured Codex node in one panel.
- Discover repository Skills from the projects known to each node without exposing repository paths.
- Enable or disable any discovered local Skill through Codex's native `[[skills.config]]` configuration without deleting the Skill.
- Identify equal and divergent copies with a deterministic content hash.
- Copy a selected Skill from its owning device to one or more trusted nodes.
- Preserve executable script bits and all regular files in the Skill directory.
- Detect concurrent changes and install atomically with a recoverable backup.

## Non-goals

- Do not synchronize OpenAI system Skills, plugin caches, credentials, configuration, or arbitrary filesystem paths.
- Do not continuously overwrite files in the background or elect a central source of truth.
- Do not merge two divergent Skill directories.
- Do not distribute plugins or MCP credentials; those retain their own installation flows.

## User experience

The new “技能共享” module lists devices, connection state, personal Skills, scope, description, size, update time, and a short content fingerprint. Within each device, personal Skills are collected in one “个人技能” group and repository Skills are collected by project name in separate “项目 · &lt;name&gt;” groups. Group headers show total and enabled counts. Personal groups start expanded; project groups with multiple Skills start collapsed and remain independently expandable without mutating Skill state. Equal fingerprints are shown as synchronized. The user chooses one copy as the source and selects “同步到其他设备”. The confirmation names targets and warns that differing copies will be backed up and replaced.

Every personal or project group header also exposes an aggregate enable switch and a “共享全部” action. The switch is checked when every Skill is enabled, unchecked when none are enabled, and indeterminate for a mixed group. Changing it applies the requested state sequentially to every Skill whose state differs. “共享全部” confirms the source group and all reachable target devices once, then shares every Skill in the group sequentially. Repository Skills retain the explicit “共享为个人技能” meaning on targets. Batch operations continue after an item failure, refresh authoritative state afterward, and report success and failure counts without claiming atomicity.

Unavailable nodes remain visible and do not block healthy nodes. A partial result reports each target independently. Empty nodes explain the supported personal Skill locations. Refresh never mutates a device.

## Contracts and data

`GET /api/node/skills` returns a schema-v2 local-only catalog. `GET /api/node/skills/content?scope=...&sourceId=...&name=...` returns one bounded, base64-encoded package owned by that node. Neither endpoint returns absolute paths. A Skill identity is the tuple `(scope, sourceId, name)` because two repositories can contain directories with the same name.

`GET /api/skills` aggregates the local catalog and configured peer catalogs. `POST /api/skills/sync` requires the exact dashboard origin and accepts a source device, scope, opaque source id, Skill directory name, source hash, and target device ids. A repository Skill is deliberately installed as an `agents-user` Skill on other devices; the confirmation and action label say “共享为个人技能” so this scope promotion is not implicit.

`POST /api/skills/toggle` requires the exact dashboard origin and changes one Skill on one selected device. Remote mutation uses the signed `POST /api/node/actions/skill-toggle` owner route. The owning node resolves the opaque identity again, edits its native Codex configuration atomically, and returns `restartRequired: true`. The panel explains that new Codex tasks see the change after Codex restarts.

A successful signed owner mutation always returns `accepted: true` together with its resulting state. The coordinator must not report rejection after the owner has already committed the configuration change.
During rolling upgrades, the coordinator also accepts a signed legacy response only when it has `status: "ok"`, omits `accepted`, and contains a boolean resulting `enabled` state. Explicit rejection, missing state, malformed state, and unauthenticated responses still fail closed.

Remote installation uses the existing signed owner-action boundary at `POST /api/node/actions/skill-install`. The package contains at most 128 regular files and 2 MiB of decoded content. Paths must be relative, normalized, and free of dot segments. Nested symbolic links and special files are rejected. A top-level linked Skill may be read as a bounded source, matching Codex discovery behavior, but is never replaced on a target.

Scopes are:

- `codex-user`: `<source CODEX_HOME>/skills`, retained for this product's existing installations.
- `agents-user`: `<user home>/.agents/skills`, the current cross-project Codex user location.
- `repo`: `.agents/skills` in a repository known from the owning node's task index. The API exposes a one-way opaque source id and display name, never its absolute path.

Directory names and declared Skill names are kept distinct. Content hashes cover sorted relative paths and bytes so the same Skill has the same fingerprint on POSIX and Windows; executable state is transported and restored where the platform supports it. Target writes include the cataloged target hash; an unexpected current hash is a conflict rather than an overwrite.

## Design and ownership

- `src/skill-contract.mjs` owns bounded normalized catalogs/packages and hashing.
- `src/local-skill-adapter.mjs` owns allowlisted filesystem discovery, export, backup, and atomic install.
- `src/skill-config-store.mjs` owns narrow, atomic edits to Codex's `[[skills.config]]` entries while preserving unrelated TOML.
- `src/skill-sync-service.mjs` owns source/target routing and per-device results.
- `src/skills-http.mjs` owns local node, browser aggregation, and signed owner routes.
- `src/ssh-peer-adapter.mjs` and `src/ssh-peer-commands.mjs` transport only normalized Skill contracts.
- `public/features/skills/` renders normalized data and sends explicit sync requests.

The domain contract does not import filesystem, HTTP, SSH, or DOM modules. `src/main.mjs` only composes the adapters and service.

## Security and privacy

- All HTTP listeners remain loopback-only; remote access continues through authenticated SSH.
- Browser mutation requires the exact dashboard origin. Remote mutation additionally requires the existing HMAC signature and replay window.
- No SSH keys, Codex authentication, plugin caches, or paths are returned to the browser.
- Personal writes are confined to two configured Skill roots. Repository roots are discovered only from locally indexed task working directories; callers address them with opaque ids that are resolved afresh. Symlinked roots and nested files fail closed. A top-level linked Skill can be exported, but synchronization never writes back into a repository or replaces a linked target.
- Toggle writes are confined to configured Codex `config.toml` files and only change the exact matching `[[skills.config]]` block. Other settings and comments are preserved, and replacement is atomic.
- Installation stages a new directory, verifies its hash, renames the old directory into a timestamped backup, and then promotes the staged directory.
- A concurrent target change fails with `409`; the console never silently merges or overwrites it.

## Rollout and rollback

Nodes without the new endpoints appear as unavailable for Skill sharing while all existing console features continue working. No synchronization runs until the user presses the action and confirms it.

Rollback removes the feature code without touching Skills. Replaced copies remain recoverable from the owning node's `skill-sync-backups` directory. A user can restore a backup manually.

## Acceptance criteria

- [x] Each healthy node exposes only bounded personal Skill metadata without absolute paths.
- [x] Equal content receives equal hashes across macOS and Windows.
- [x] A user can copy a local or remote source Skill to selected peer devices.
- [x] Missing targets are installed; divergent targets are backed up and replaced only when their observed hash still matches.
- [x] Linked targets, traversal, oversized packages, stale hashes, unsigned owner actions, and wrong browser origins fail closed.
- [x] Partial peer failures remain visible without losing successful target results.
- [x] Existing conversation, Turbo, project-copy, and federation behavior remains unchanged.
- [x] Repository Skills from known projects appear with their project name and can be shared as personal Skills.
- [x] Every discovered Skill shows its native enabled state and can be enabled or disabled on its owning device.
- [x] Toggle routes enforce exact-origin or signed-owner authorization and never accept a filesystem path from the browser or a peer.
- [x] A successful remote toggle returns an explicit acceptance confirmation, so the coordinator cannot misreport an applied change as rejected.
- [x] A newly upgraded coordinator can safely control an older authenticated node whose successful toggle response predates the explicit confirmation field.
- [x] Each device groups personal Skills separately and repository Skills by project name, with deterministic group order and truthful total/enabled counts.
- [x] Expanding or collapsing a project group never changes Skill enablement or synchronization state.
- [x] Personal and project group headers expose a truthful checked, unchecked, or mixed aggregate enable switch.
- [x] One group switch applies the requested state to every differing Skill sequentially and reports partial failure truthfully.
- [x] “共享全部” shares every Skill in the selected group to every reachable peer after one explicit confirmation, preserving project-to-personal scope wording and per-item conflict safeguards.

## Verification plan

- Unit: contract validation, deterministic hashes, filesystem discovery/export/install, conflict and symlink rejection.
- Integration: local node catalog/content, exact-origin sync, signed remote install, and mocked SSH routing.
- Real UI: inspect two configured nodes, copy a test Skill both ways, confirm matching fingerprints, and verify backup creation for an explicit replacement.
- Structure and regression: `npm run check` and `npm test`.

## Shipped deviations

- The accepted design initially rejected every symbolic link. Real inventory found
  the actively developed local `orch` Skill is linked, and official Codex
  discovery supports linked Skill folders. The shipped contract therefore
  exports bounded top-level links as sources while still refusing to replace a
  linked target or traverse nested links.
- The complete runtime was deployed to MatrixBook Air, MacBook Pro, and Windows
  Desktop. The aggregate endpoint reported all three connected and identified
  two local Skills, two MacBook Pro Skills, and one Windows Skill without
  exposing any absolute Skill path. Windows remained reachable through the
  configured authenticated relay when its direct route was temporarily
  unavailable.
- `npm run check` passed with 253 files and zero structural debt. The complete
  suite passed 353 tests after deployment; node catalog, package, origin,
  signature, conflict, backup, link, partial-failure, and cross-platform hash
  behavior have dedicated coverage.
- The repository-scope and native-toggle extension was deployed to all three
  nodes. The aggregate schema-v2 catalog reports 22 Skills: two on MatrixBook
  Air, two on MacBook Pro, and eighteen on Windows Desktop. Seventeen Windows
  entries are enabled repository Skills from `WorldManager`; the UI exposes 22
  native enablement switches and labels all 17 project copies as “共享为个人技能”.
  `npm run check` passed with 255 files and zero structural debt, and the full
  suite passed 356 tests.
- The grouping refinement presents personal Skills first and then one collapsible
  group per repository display name. Live verification showed `项目 ·
  WorldManager`, `17 个 · 17 个启用`, successful expand/collapse behavior, and
  unchanged per-Skill controls. The full suite passed 399 tests.
- The signed owner toggle initially committed the native configuration but omitted
  `accepted: true`, causing the coordinator to misreport every successful remote
  toggle as rejected. The owner response now makes acceptance explicit and the
  integration test asserts the complete success payload. The coordinator also
  recognizes the old signed success shape during rolling upgrades, so an offline
  node does not have to be upgraded before its switches work again. The final
  structure check passed with zero debt and the complete suite passed 430 tests;
  reversible live toggles succeeded against both the legacy Mac response and the
  upgraded Windows response, with both Skills restored to their starting states.
- Personal and project group headers now contain a tri-state “整组启用” switch and
  a “共享全部” action. Batch plans skip already-matching enablement states, run
  sequentially, preserve every Skill locator and hash, continue after item-level
  failures, and refresh authoritative counts. Headless interaction coverage verifies
  mixed-state rendering and disclosure click isolation. The complete suite passed
  440 tests with zero structural debt; the assets were deployed and hash-verified on
  MatrixBook Air and Windows Desktop. MacBook Pro remained reachable as a controlled
  node but its own panel deployment was pending because direct SSH was unavailable.
