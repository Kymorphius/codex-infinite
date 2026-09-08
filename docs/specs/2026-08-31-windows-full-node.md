# Windows full Codex node

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-31
- Related ADRs: `docs/adr/0012-cross-platform-desktop-host.md`

## Problem

Codex Control Console currently assumes that every full node is macOS. The
desktop launcher searches processes with `ps`, resolves the native executable
inside `/Applications/ChatGPT.app`, stores its dedicated Chromium profile in a
macOS application-support directory, and relies on LaunchAgents for persistence.
The Windows host `admin@192.168.1.234` already has Node.js, Git, OpenSSH, Codex
CLI, and the unified `OpenAI.Codex` ChatGPT package, but the current launcher
cannot safely start or attach to an isolated wrapper there.

## Goals

- Run the complete native ChatGPT/Codex desktop runtime and control console as
  a third, equal federated node on Windows.
- Resolve and inspect the installed Windows MSIX desktop executable without
  hard-coding its versioned `WindowsApps` directory.
- Keep the wrapper Chromium profile and wrapper `CODEX_HOME` separate from the
  ordinary ChatGPT profile and configuration.
- Start the Windows node only in the signed-in user's interactive desktop
  session and keep dashboard and CDP listeners on `127.0.0.1`.
- Preserve the existing macOS launch and federation behavior.
- Preserve Unicode project, task, and action data exactly across direct
  Windows SSH transport.

## Non-goals

- Repackaging or modifying the signed OpenAI MSIX application.
- Enabling Developer Mode, changing system-wide symlink policy, or resetting
  the ordinary ChatGPT profile.
- Replacing the full desktop runtime with a standalone App Server.
- Exposing dashboard or CDP listeners on the LAN.
- Adding Windows UI-specific product behavior in this increment.

## User experience

An administrator runs the Windows installer script once from an elevated
PowerShell session. The installer validates prerequisites, installs the source
tree to a user-owned application directory, prepares the private runtime
configuration and wrapper links, and registers a logon-triggered scheduled task.
At the next task start, the control service launches or attaches to a dedicated
ChatGPT window in the current user's desktop session. The normal ChatGPT entry
continues using its original profile.

Prerequisite, package-resolution, link, launch, and health failures are reported
as explicit installer or service errors. The installer does not silently enable
OS features or fall back to the ordinary profile.

## Contracts and data

- `getConfig` gains Windows defaults derived from `LOCALAPPDATA` while retaining
  environment overrides.
- The desktop launcher accepts an explicit platform adapter boundary and
  returns the existing `{ mode, pid, profileDirectory, version }` result.
- The wrapper fingerprint is carried in both the child environment and a
  non-secret process argument so Windows process inspection can verify it.
- Windows runtime settings are stored under the wrapper `CODEX_HOME`; no
  credentials are embedded in the scheduled-task command line.
- Snapshot and owner-routed action payload schemas remain unchanged. Peer
  definitions add a bounded `platform` field so direct Windows SSH transports
  can use encoded PowerShell while POSIX and relay transports keep `curl`.
- Direct Windows PowerShell commands explicitly use UTF-8 for console input and
  output. JSON responses and action request bodies must not depend on the
  machine's active OEM code page.

## Design and ownership

- `src/desktop-host.mjs` owns platform-specific executable resolution, process
  listing, and launch metadata normalization.
- `src/launcher.mjs` retains the platform-neutral dedicated-instance lifecycle,
  loopback checks, CDP polling, and refusal rules.
- `src/config.mjs` owns platform-specific default paths only.
- `src/wrapper-codex-home.mjs` retains the allowlisted shared-entry policy and
  creates Windows directory junctions where appropriate.
- `src/windows-writer-inspection.mjs` owns bounded Restart Manager lock-owner
  inspection; `src/native-writer-locator.mjs` retains fail-closed routing.
- `src/ssh-peer-commands.mjs` owns fixed POSIX and Windows peer commands without
  placing message bodies or credentials in SSH arguments. It also owns the
  explicit UTF-8 console boundary for direct Windows transport.
- `scripts/install-windows.ps1` owns prerequisite checks, installation, private
  node configuration, scheduled-task registration, start, and rollback guidance.
- `src/main.mjs`, domain services, HTTP contracts, and browser modules remain
  platform-independent.

## Security and privacy

- Dashboard and CDP hosts remain exactly `127.0.0.1`; existing validation still
  rejects wildcard, `localhost`, and LAN addresses.
- The Windows wrapper uses dedicated profile and configuration directories and
  never points `--user-data-dir` at the package's ordinary profile.
- Package discovery queries only the installed `OpenAI.Codex` package and never
  mutates `WindowsApps`.
- Process queries return bounded process metadata and do not read credentials.
- The scheduled task runs only for the named interactive user. The installer
  may use elevation to prepare allowlisted links, but the persistent runtime is
  not elevated.
- Peer credentials remain in user-private files and never enter browser state,
  URLs, process arguments, or logs.

## Rollout and rollback

Roll out to `admin@192.168.1.234` after local tests pass. The installer first
validates the OpenAI package, Node.js 22+, Codex CLI, OpenSSH, target paths, and
symbolic-link capability. It then registers a disabled-by-default task, starts it
explicitly, and verifies loopback health before considering deployment complete.

Rollback stops and unregisters only the control-console scheduled task and
removes the deployed wrapper directory after an explicit operator action. It
does not uninstall ChatGPT, delete the ordinary `.codex` directory, remove user
sessions, or reset the ordinary profile.

## Acceptance criteria

- [x] macOS launcher tests and behavior remain unchanged.
- [x] Windows package discovery resolves the installed unified ChatGPT
  executable without a versioned hard-coded path.
- [x] Windows process discovery distinguishes the expected dedicated profile
  and wrapper fingerprint from the ordinary ChatGPT instance.
- [x] The Windows wrapper launches with loopback-only CDP, an independent
  profile, and an independent wrapper `CODEX_HOME`.
- [x] The scheduled task runs in `admin`'s interactive logon session and the
  dashboard health endpoint answers only on `127.0.0.1:47831`.
- [x] The ordinary ChatGPT profile and processes are not terminated, reset, or
  reused during installation and verification.
- [x] The Windows node returns a valid local snapshot and can participate in the
  existing bounded peer contract.
- [x] Direct Windows snapshots preserve Chinese project and task names without
  replacement characters or mojibake.
- [x] Direct Windows actions preserve UTF-8 request and response bodies.
- [x] `npm run check` and `npm test` pass without a structure-budget increase.

## Verification plan

- Unit: Windows path defaults, package output parsing, process normalization,
  wrapper fingerprint/profile matching, and macOS regression tests.
- Integration: mocked Windows desktop launch with exact loopback arguments and
  safe refusal for an occupied/mismatched CDP endpoint.
- Real UI: start the scheduled task on `192.168.1.234`, verify a distinct native
  wrapper window and dashboard injection, and confirm ordinary ChatGPT remains
  independently launchable.
- Structure and regression: `npm run check`, `npm test`, PowerShell parse check,
  and loopback listener inspection on Windows.

## Shipped deviations

- Windows enables the target-scoped CSP bypass without rebuilding the desktop
  document because a reload can abort the packaged app's bootstrap navigation.
  macOS retains the one-time reload. The injected iframe also explicitly
  delegates the Chromium `local-network-access` permission required by newer
  desktop builds. The duplicate guard and exact target selection keep recovery
  idempotent.
- Windows writer ownership uses the operating system's Restart Manager API
  rather than macOS `lsof`, then follows the bounded process ancestry through
  the same fail-closed routing policy.
- Direct Windows peer requests use UTF-16LE Base64-encoded PowerShell commands.
  POST bodies continue over stdin, signed action keys remain in private files,
  and relay requests remain POSIX-only.

## Deployment evidence

- Installed at `C:\Users\Admin\Applications\CodexControlConsole` and registered
  `Codex Control Console` as an interactive, limited scheduled task for Admin.
- The dashboard and CDP listeners were observed only on `127.0.0.1:47831` and
  `127.0.0.1:9231`; the dedicated profile is under `LOCALAPPDATA\Codex Control
  Console\Profile` and does not reuse the ordinary package profile.
- Native inspection found the `app://-/index.html` ChatGPT target with all four
  current sidebar modules injected exactly once and 160 local tasks. A live
  federated snapshot and the macOS sidebar DOM both preserved Chinese Windows
  project and task names without replacement characters.
- `matrix-air`, `forest-mac`, and `windows-pc` each reported all three nodes
  connected and the same aggregate of 480 tasks.
- Syntax and structure checks passed for 182 and 200 files respectively with
  zero frozen debt. All 268 tests passed.
