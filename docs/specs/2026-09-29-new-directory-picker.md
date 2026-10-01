# 「新建」多目录项目选择目录

- Status: shipped
- Owner: Claude
- Date: 2026-09-29
- Related ADRs: none

## Problem

The shortcut bar's 「新建 → Claude CLI 会话」 needs a working directory. From a GPT conversation, a project with several directories stopped with 「该项目有多个目录，请在项目菜单里选择目录新建 Claude」. From a Claude conversation it always reused the current directory, so the project's other directories could not be chosen.

## Goals

- When the project has more than one directory, 「Claude CLI 会话」 lists the directories in the same menu and creates the conversation in the chosen one.

## Non-goals

- 「GPT 会话」: the native new chat is project-level (all roots), so it gets no directory choice.
- 「讨论」's new discussion, which still requires a single-directory project.

## User experience

- Single-directory projects, or a Claude conversation whose project cannot be resolved, behave as before and create immediately.
- Multi-directory projects: the menu stays open and switches to one entry per directory, then 「返回」.
  - Each entry shows the folder name, with the full path as detail and tooltip. Duplicates are removed.
  - The current Claude conversation's directory is listed first and marked 「（当前会话目录）」.
  - Focus moves to the first entry.
- Picking a directory closes the menu and creates the conversation. 「返回」 restores the two engines. Closing by Escape, an outside click, or the trigger also restores them.

## Contracts and data

None changed. The current directory uses `__cccTerminalConversations.fresh(record)`, which keeps the conversation's `projectRef`. Other directories use `__cccTerminalConversations.create(project, directory, 'claude')`, which already checks that `directory` is one of the project's `sourceDirectories`.

## Design and ownership

Only `src/native-new-conversation-button.mjs` changes. The injection VERSION in `src/native-conversation-tabs.mjs` is bumped so open pages reinstall.

## Security and privacy

No new boundary. Directory candidates come from the catalog project, and the terminal create path still rejects directories outside the project.

## Rollout and rollback

Revert the module and the VERSION bump.

## Acceptance criteria

- [x] One directory creates directly; no directory explains itself (`test/native-new-conversation-button.test.mjs`).
- [x] Several directories are listed, and the chosen one is used (same file).
- [x] 返回, Escape and the trigger restore the engine list without creating anything (same file).
- [x] From Claude: the current directory comes first and uses `fresh`; other directories use `create` (same file).

## Verification plan

- Unit: `test/native-new-conversation-button.test.mjs`.
- Real UI: in a multi-directory project, open a GPT conversation and choose 新建 → Claude CLI 会话, then pick the second directory. Confirm the Claude conversation starts there. Verified by the user on 2026-09-29 in the running app.
- Structure and regression: `npm run check`, `npm test`.

## Shipped deviations

None yet.
