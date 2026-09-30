# Windows 项目副本创建目录启动配置

Status: implemented; Windows launcher and directory contract verified; native registration availability remains blocked

## Problem and resulting behavior

Windows service startup currently omits the optional project-copy directory configuration. The runtime therefore uses `C:\Users\Admin\333.dev`, which is absent on the inspected device. Its existing project parent is `D:\333.开发`.

`windows-node.json` may now contain `projectCopyRoots`, an optional nonempty array of absolute Windows directory strings. Startup reads the JSON as UTF-8, validates each value before starting Node, and joins the values with `;` into `CODEX_CONTROL_PROJECT_COPY_ROOTS`. When the property is omitted, startup removes any inherited variable and lets the runtime use its existing default. The launcher does not create directories.

## Contract and boundaries

- Explicit configuration must be an array with at least one string. Null, scalars, empty lists, blank strings, drive-relative/root-relative paths, null bytes, line breaks and the Windows path-list delimiter `;` fail before service launch.
- Absolute drive paths and complete UNC paths are accepted by the launcher; the existing replica adapter independently requires an existing writable canonical allowlisted directory, rejects links and parents inside Git repositories, and validates each operation.
- Existing startup fields and device-local credentials remain intact. No native project registry or task database is changed.
- A stopped service can be started using its verified existing scheduled task. A running service with unknown/running terminal state must remain running.

## Verification and rollout

- Focused tests execute the real launcher with a fake child process on Windows, covering configured Unicode paths, multiple roots, absent configuration with a stale inherited variable, and malformed input.
- Non-Windows runs verify the startup contract without claiming PowerShell execution.
- Before the device update, compare the installed startup script with the known original hash, then back up the exact script and configuration. Add only `projectCopyRoots: ["D:\\333.开发"]` to the existing configuration. Retain an undo manifest and verify hashes after atomic replacement.
- Confirm the loaded runtime returns `D:\333.开发` as a usable creation parent, preserves native application processes, and does not interrupt active managed terminals.

## Verification evidence

- Windows executed all 15 focused tests successfully, with no skipped cases; test-owned files were cleaned. The macOS contract checks passed and explicitly skipped the 14 PowerShell execution cases.
- Installed startup script bytes match commit `dbe3429` (SHA-256 `4fa6a0d060399143a3fe50bdad93a77a0ba59f6fc3ed8c86bceeb770512419ed`). The saved configuration includes the new parent, and a semantic comparison confirmed every previous configuration field was retained.
- Backups are in `C:\Users\Admin\.codex-control-console\backups\windows-copy-roots-1790760825519`, with exact before/after hashes in the manifest. Before starting its existing task, Windows had no console entrypoint process and no dashboard listener. The started service has zero managed terminals; all 25 previously observed native application process IDs remained present.
- The real replica destination validator accepts `D:\333.开发`, and the creation page returns HTTP 200. The production `create-options` request still fails because native CDP initialization times out at `Runtime.enable`; the endpoint's usable-parent readback is therefore not yet accepted. Independent read-only commands to the unique `app://-/index.html` main target timed out after five seconds for both `Runtime.enable` and a basic `Runtime.evaluate`. This is a remaining native host responsiveness issue, not evidence that the directory was unavailable. No native application restart was attempted.
