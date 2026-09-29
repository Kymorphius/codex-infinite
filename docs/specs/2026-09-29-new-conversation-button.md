# 新建 button beside 最近发送

## Problem

Claude's `/clear` swaps a running CLI to an unlinked session id, so a managed
conversation silently forks. Intercepting `/clear` in the composer proved unreliable in
the dedicated window, so it is dropped. The need behind it: start a clean conversation in
the same project as the one being worked in, without hunting through the sidebar.

## Behavior

- A `新建` button sits in the shortcut bar next to 最近发送 (same style, icon-only when the
  bar is narrow). Clicking opens a two-item menu: `GPT 会话` and `Claude CLI 会话`.
  Both create in the project of the active conversation, whatever its own kind is.
- The button acts on the active conversation tab and is enabled only for a native Codex
  conversation or a Claude CLI conversation. Anything else (console, ChatGPT, remote,
  shell, no tab) disables it and closes the menu; its tooltip says what to open first.
- Target × source:
  - Claude from Claude: a new managed Claude conversation with the same directory and
    project link, started and opened.
  - GPT from GPT: the project's native "new chat" entry, exactly like the `+` in project
    search.
  - GPT from Claude: the native "new chat" entry of the project whose directories contain
    the Claude conversation's directory.
  - Claude from GPT: a new Claude conversation in the project's single directory. A project
    with several directories is refused with a hint to use the project menu, because the
    directory would be a guess.
- The source conversation is never touched. Menu closes on choice, outside pointer, Escape.
- Failures show a short toast and create nothing: Claude record not found, directory
  invalid, or a project that cannot be resolved (for a Codex source, expand it in the
  sidebar first).
- `/clear` typed anywhere reaches Claude unchanged; the console does not intercept it.

## Design

- `src/native-new-conversation-button.mjs` (page module, injected with the tabs source):
  button, menu, enablement and routing. Installed by the tab controller and updated on
  every render.
- Project lookup uses the search catalog: `__codexControlConsoleProjectSearch`
  `projectOfTask(id)` and `projectOfDirectory(cwd)` (local projects only); a Codex task
  falls back to its sidebar row's project list id.
- Claude targets reuse `createNativeTerminalActions()`: `fresh(record)` for a Claude source
  (existing exact-origin `create` with `cwd`, `kind: "claude"`, `projectRef`) and
  `create(project, cwd, "claude")` for a Codex source. GPT targets use
  `__cccProjectSearchActions.create(project)`.
- No new server operation, contract or storage.

## Verification

- Unit tests: `fresh` payload/failure, enablement per tab kind, all four source × target
  routes and their failure paths, menu dismissal, injection wiring; `projectOfTask`,
  `projectOfDirectory`.
- `npm run check`, `npm test`; live check in the dedicated window after a backend restart.

## Non-goals

- Cloning the old conversation's context, titles or history; remote or ChatGPT projects.
