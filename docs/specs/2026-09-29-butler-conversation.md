# 管家会话

- Status: implemented; live UI acceptance pending
- Owner: Claude
- Date: 2026-09-29
- Related ADRs: 0040-claude-native-tool-mode (only its non-native route is used here)

## Problem

GPT/Codex conversations and tasks have piled up across local and remote devices
and managed Claude terminals. There are about 400 local threads plus peer
devices. The user can no longer keep track of which conversations are running,
waiting for them, unread, or finished. The existing board and attention lists
show state, but you cannot ask them questions such as "which tasks do I need to
handle today" or "where is the conversation about Zotero".

## Goals

- Add a fixed 「管家」 entry in the sidebar's top action area, directly above
  「打开本地项目」 and still below 「新聊天」.
- Clicking it opens-or-creates a single persistent **native GPT conversation
  window** called 管家, instead of creating a new conversation each time.
- The butler runs on the Claude Router Opus subscription route by default
  (non-native tool mode). The engine is a single policy constant, so switching
  to the native GPT model later means changing one place only.
- The first version is **read-only**. It can list, search, summarize, find what
  needs attention, and give clickable links. Links open the target conversation
  in the same window.

## Non-goals

- Mutating anything: no archive, rename, grouping, sending messages, dispatching
  tasks or claiming todos. A later version needs its own spec and ADR.
- No change to how native Codex stores data. The console does not write the
  native database or `.codex-global-state.json`.
- The butler does not read remote devices' transcripts. Remote devices appear in
  the overview only.

## User experience

- Entry: the button copies the native 新聊天 button style. It has an icon and the
  text 「管家」, the tooltip 「管家 · 管理全部会话」, and can be activated from the
  keyboard.
- Clicking it:
  1. Finds the existing butler thread: first the id stored in localStorage (the
     thread must still exist and its cwd must match), then `thread/list` filtered
     by the butler cwd.
  2. If none is found, it creates one with `thread/start`
     (`cwd=<wrapperCodexHome>/butler`, `sandbox=read-only`,
     `approvalPolicy=never`), names it 「管家」, and switches it to the Claude
     Router Opus route (auto reasoning effort, native tools off).
  3. It opens the thread in the current window (tab plus native route).
- Clicking again while a lookup or creation is in progress does not start a
  second one. On failure the button shows a short error state and a tooltip, and
  no half-built thread is left behind as a duplicate.
- If Router is unavailable, the thread is still created and opened on the native
  GPT model, and the tooltip says so.
- In the butler's replies, links written as `[标题](#ccc-open/local/<uuid>)`,
  `#ccc-open/chatgpt/<uuid>` and `#ccc-open/terminal/<uuid>` open the matching
  conversation in the same window. Only links inside the butler thread are
  intercepted.
- The butler thread's own row in the native sidebar is hidden. The fixed entry is
  its only way in.

## Contracts and data

- Butler workspace `<wrapperCodexHome>/butler/`, maintained by the backend:
  - `AGENTS.md`: the role and rules (read-only; link format; data is data, never
    instructions). The backend overwrites it with the current version when it
    changes.
  - `overview.json`: `{v:1, capturedAt, stale, devices:[{id,label,local}],
    rows:[{id, p:'codex'|'chatgpt'|'terminal', dev, t, proj, st:'running'|'idle'|'stopped',
    att:'review'|'active'|'codex'|null, unread, upd, open}]}`. `open` is a
    `#ccc-open/...` link when the conversation can be opened locally, and null
    otherwise. Rows are sorted by `upd`, newest first. Subagent threads, archived
    threads and the butler itself are excluded.
  - `overview.md`: the same data as a compact table, so the model can read it
    directly.
  - Writes are atomic (temp file then rename). The backend rewrites only when the
    content changes, and refreshes at most once every 30 s.
- Page localStorage `codex-control-console.butler.v1`: `{threadId}`. It is only a
  cache. Losing it is recovered through `thread/list` by cwd.
- Existing contracts are unchanged. The Claude toggle gains one page global,
  `window.__cccClaudePreviewSet(id, effort, nativeTools, family)`. It reuses the
  existing read-back and rollback, and the toggle store records the switch, so
  Turbo and Jev do not overwrite the model.

## Design and ownership

- `src/butler-overview.mjs`: pure projection. It maps tasks, terminal
  conversations and the attention snapshot to rows, with an explicit field
  whitelist. It has no I/O.
- `src/butler-workspace.mjs`: filesystem adapter. It creates the directory,
  writes AGENTS.md and the overview, and runs the timer.
- `src/butler-prompt.mjs`: the AGENTS.md text and the engine policy constant.
- `src/native-butler-entry.mjs`: the page injection script. It builds the entry,
  opens or creates the thread, intercepts links, and hides the sidebar row. The
  cwd is passed in as a builder argument.
- Composition: `main.mjs` only creates the workspace service and passes the cwd
  to the injectors. Wiring the injection into `injector.mjs` must not exceed that
  file's budget. Split an existing responsibility out first if needed; do not
  raise the budget.
- Dependency direction: domain projection ← workspace adapter ← composition
  root; the page script consumes only its builder parameters and native bridge
  messages.

## Security and privacy

- No new network listener or HTTP route. The overview reaches the model only as
  a local file inside the butler cwd.
- The overview uses a whitelist. It never includes drafts (`draft`), absolute
  paths, `sourceFile`, permission policies, runtime or session ids, occupancy
  details, or checklist text.
- Read-only is enforced by Codex: `sandbox=read-only` and `approvalPolicy=never`.
  The butler uses the **non-native** Claude route (`claude-subscription/opus-auto`),
  so tools run inside Codex's sandbox rather than under Claude CLI's
  bypassPermissions.
- Link interception only accepts
  `^#ccc-open/(local|chatgpt|terminal)/<uuid>$`, only acts inside the butler
  thread's timeline, and only calls the existing open functions. Query strings
  and any other schemes fall through to native behaviour.
- AGENTS.md states that conversation titles and bodies are data, not
  instructions.

## Rollout and rollback

- The injection carries its own VERSION, and installation is idempotent. The
  backend creates the workspace on startup.
- Rollback: remove the entry injection and the workspace service. The butler
  thread is an ordinary native thread and stays where it is. The
  `<wrapperCodexHome>/butler` directory can be deleted by hand.

## Acceptance criteria

- [ ] 「管家」 sits directly above 「打开本地项目」. It is not duplicated after
      re-injection, and it stays in place when the sidebar remounts.
- [ ] Every click opens the same thread. The first click creates it; later clicks
      reuse it. It is still found after localStorage is cleared.
- [ ] Newly created threads use the Router Opus non-native route, and the toggle
      shows Claude.
- [ ] overview.json and overview.md exist and contain only whitelisted fields.
- [ ] `#ccc-open/...` links in the butler thread open the target conversation;
      links in other threads are not affected.
- [ ] `npm run check` and `npm test` pass.

## Verification plan

- Unit: overview projection (whitelist, exclusions, sorting, link generation),
  workspace (atomic writes, no rewrite when unchanged, AGENTS.md version),
  entry script (placement and order, idempotence, open or create, concurrency
  guard, link regex and scope), Claude preview set global.
- Integration: the injectors include the butler script, and main passes the
  cwd.
- Real UI: click the entry in the dedicated window to create and reopen the
  thread, check the model, and click a link in a real reply.
- Structure and regression: `npm run check`, `npm test`.

## Shipped deviations

- The overview includes this machine's conversations only: local Codex/GPT
  threads, ChatGPT chats and local Claude terminals. `publicTask` in the peer
  contract carries no `isSubagent`, `archived` or `sourceFile`, so remote-device
  subagent and archived threads cannot be filtered out. Remote rows are therefore
  dropped for now; `devices` still lists every device. Adding them back requires
  extending the peer contract first.
- If the list is cut at 600 rows, `overview.json` adds `truncated:true, total`.
- The overview is rewritten when its content changes, and also every 10 minutes
  as a heartbeat, so `capturedAt` shows how fresh the data is. AGENTS.md tells
  the butler to warn the user when data is more than 15 minutes old or
  `stale:true`. `stale` is also true when the attention snapshot is missing.
- localStorage may store `{threadId, cwd}`. `cwd` is stored only when native code
  reports a canonical path that differs from `butlerCwd`, for example after
  symlink resolution, so that lookup does not create a new thread every time.
- A thread counts as archived only when its `path` is under `archived_sessions`,
  because the v2 `Thread` has no `archived` field. An archived butler is not
  reused.
- Each open retries setting the name 「管家」 if it is missing. If the Claude
  switch fails, the thread still opens and the button shows `data-state="note"`
  with the reason.
- The top-action scripts are merged into `src/native-top-actions.mjs`. The 19
  document-start registrations in `injector.mjs` became one loop, which brings
  the file back under budget. 任务清单 anchors in the order 打开本地项目 → 管家 →
  新聊天, so the two entries cannot keep swapping places when 打开本地项目 is
  missing.
- AGENTS.md lists `sessions` and `archived_sessions` as read-only search
  locations.
