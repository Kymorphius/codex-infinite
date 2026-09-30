# Windows 项目副本创建目录启动配置

Status: implementation in progress

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
