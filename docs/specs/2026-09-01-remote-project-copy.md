# Remote project and conversation copy

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-01
- Initial route: Windows Desktop to MatrixBook Air

## Problem

The session center can show a project owned by another device, but cannot make
its working tree available locally. Manually copying a path is error-prone,
especially across Windows and macOS, and a partial copy must never appear as a
finished project.

## Goals

- Let a user copy one exact remote session project to an explicitly chosen
  absolute local directory.
- Clone every idle native Codex conversation currently assigned to that exact
  remote project into locally owned native threads with new identifiers.
- Resolve the source only from a connected, trusted node and an exact working
  directory already present in the normalized session snapshot.
- Compare Windows snapshot paths through the same canonicalizer used by the
  copy contract, so an extended-length `\\?\D:\...` path and its ordinary
  `D:\...` spelling identify the same exact directory. Comparison remains
  case-insensitive as required by Windows and never falls back to project-name
  matching.
- Preflight the remote tree, reject reparse points, report included files,
  bytes, and exclusions, then require a second explicit copy action.
- Copy into a unique sibling staging directory, verify every included file by
  size and SHA-256, and promote it only when the destination is still absent.
- Preserve source files and native conversation ownership unchanged.

## First-increment scope

- Direct SSH/SFTP transport only; relay-only nodes are reported unsupported.
- Windows sources are supported first. The default regenerated-directory
  exclusion is the root `target` directory. `.git`, source, configuration, and
  lock files remain included.
- The local destination parent must already exist. The final destination must
  not exist, and no overwrite, merge, delete-source, or synchronization mode is
  provided.
- Credentials, browser profiles, global configuration, and remote conversation
  ownership are never copied. Conversation history is cloned under a fresh
  local session identity and indexed as an independent native thread.

## Contracts

- `POST /api/project-copy/preflight` accepts `deviceId`, `sourceDirectory`, and
  `destinationDirectory` from the exact dashboard origin.
- `POST /api/project-copy/execute` accepts the same exact selection plus the
  opaque preflight token. Tokens are short-lived, single-use, and bound to the
  normalized source, destination, manifest, and exclusion set.
- Source and manifest values travel to PowerShell over standard input, not in
  SSH arguments. SFTP batch commands travel over standard input.
- Browser responses contain bounded metadata only; they never contain file
  bodies, credentials, or SSH configuration.
- Remote rollout files are selected by the exact bounded thread IDs already in
  the federated project snapshot, transferred twice to private staging
  directories, and accepted only when both local hashes and the remote sizes
  agree before native import.
- Each verified rollout is written under the real local Codex session root with
  a new UUID. Only the first `session_meta` record is rekeyed and pointed at the
  copied destination; every later history record is preserved byte-for-byte.
  The app server indexes each new ID, and `project/import` atomically associates
  them with one native local project rooted at the destination.

## Safety invariants

- The source directory is never mutated.
- A destination that exists at preflight or promotion time fails closed.
- Cleanup may remove only the unique staging directory created by the current
  operation.
- Reparse points, unsupported path characters, manifest overflow, source
  changes during transfer, missing files, unexpected files, size differences,
  and hash differences all block promotion.
- Project copy changes indexed native session state only through app-server
  read, delete, metadata, section, and project-import methods; it never edits
  SQLite directly. The complete verified rollout is rekeyed before indexing so
  the local and remote nodes never share a writable session identity.
  After import, a filesystem adapter adds the app's legacy-to-app-server project
  mapping and thread assignments to both the ordinary and dedicated desktop
  state files so the imported app-server project is rendered as a real native
  sidebar project. This compatibility bridge does not duplicate conversations.
- Active remote conversations block preflight. The source rollout must remain
  hash-stable through transfer.
- If local indexing or project import fails, newly indexed threads and their
  exact new rollout files are deleted in dependency order;
  a destination created by this operation is removed. Existing user directories
  are never removed by session-only recovery.

## User experience

Remote project cards show “复制项目”. The destination defaults to the local
development root plus the project name and remains editable. Preflight shows
the included size and file count and identifies excluded generated roots. The
final result shows the verified destination; failures leave no final directory.

The injected remote-device sidebar also exposes “复制项目到本机…” from the
project row's context menu. The action carries the exact normalized device and
source-directory identity into the same session-center preflight; it never
infers a filesystem path from the displayed project name. Projects spanning
multiple working directories are shown as unavailable in this first increment.

Completed local conversations appear only through Codex's native project and
native conversation components. Complete user turns are retained so native
visibility recognizes the conversation without injecting a fake message. The
native project is placed in the native custom
section “协同”; no injected collaboration tree or duplicate conversation rows
are rendered. Future copies register their imported native projects in the same
way.

The sibling “远端” section contains only real remote devices. Its section,
project, and conversation rows reuse the active native sidebar's class and icon
templates, including the same chevrons, project icon, conversation marker,
spacing, typography, hover treatment, and counts. Only the device row uses a
distinct computer icon, preserving the ownership boundary.

The confirmation reports both project files and conversations. A successful
result reports the new local conversation count. For a directory produced by
an earlier project-only copy, a bounded session-completion operation may import
the conversations without recopying or overwriting that directory after its
project manifest is verified against the recorded copy result. That comparison
checks every transferred file except `.git/index`: Git may refresh this local
cache merely by inspecting a working tree on another operating system. No other
Git metadata or project file is exempted, and initial staged-copy verification
continues to include `.git/index`.

Selecting a different remote conversation immediately starts that exact
device-and-thread activity request even when the previous conversation still
has a refresh in flight. A stale response may not replace the newly selected
title, body, controls, or settings. Switching aborts the obsolete browser
request, clears the old body immediately, and exposes the loading state until
the newly selected remote activity arrives. A sidebar conversation action also
labels the first workspace frame as opening that conversation, rather than
presenting the session-center landing state as its destination.

The owning node retains an in-memory exact thread-to-source index from its
latest read-only session snapshot. Opening conversation activity uses that
index and reads only the selected conversation tail; it must not rescan and
reparse the complete session collection for every activity request.

The selected remote conversation uses the same native selected-thread
attribute, current-page semantics, rounded full-row background, and hover
behavior as a local conversation. Selection moves between remote conversations
and clears when a native local conversation is selected; unselected rows never
inherit an unconditional selected background from the sampled native template.
While a remote conversation is current, the previously routed native local
conversation keeps its internal ownership state but its sidebar selection
background is visually suppressed, so the sidebar presents only one current
conversation. Selecting a native conversation restores its native highlight.

Remote conversation messages render a bounded safe Markdown subset through DOM
nodes rather than arbitrary HTML. Headings, paragraphs, lists, quotations,
fenced and inline code, emphasis, and HTTP(S) links use native conversation
typography. User attachment envelopes project only their explicit `My request`
content, while transport context and attachment placeholders remain hidden.

## Acceptance criteria

- A trusted Windows project can be copied through direct SFTP with Unicode
  paths preserved.
- Every idle project conversation becomes a distinct locally owned native
  thread and appears under the imported local project.
- Remote and local thread IDs differ, and continuing either copy cannot write
  the other device's rollout.
- The `真仙幸存者` fixture copies from `D:\333.开发\真仙幸存者` to a chosen
  local directory while excluding its root `target` cache.
- Existing destinations, unindexed source paths, unavailable peers, reparse
  points, changed manifests, and verification failures do not produce a final
  project.
- A project remains copyable when the Windows snapshot changes only between
  ordinary and extended-length syntax for the same exact source directory.
- Unit tests cover contract validation, staging/promotion, origin enforcement,
  and UI request presentation. `npm run check` and `npm test` pass.
