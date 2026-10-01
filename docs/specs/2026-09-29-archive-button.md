# 「归档」快捷按钮

- Status: shipped
- Owner: Claude
- Date: 2026-09-29
- Related ADRs: none

## Problem

To archive the conversation you are reading, you have to find its row in the sidebar (GPT) or open the terminal row's context menu (Claude). The shortcut bar above the composer (最近 / 最近发送 / 新建 / 讨论) has no way to do it.

## Goals

- A 「归档」 button right after 「讨论」 archives the active GPT or Claude conversation after an explicit confirmation.

## Non-goals

- Restoring archived conversations. The existing native and terminal views keep handling that.
- Archiving both sides of a discussion pair at once, or ending the pairing.
- Archiving ChatGPT web, remote, shell-terminal, or console tabs.

## User experience

- The button is enabled only while the active tab is a native GPT (`local`, UUID id) or Claude terminal conversation. Otherwise it is disabled, and its title says why.
- Clicking opens a modal `<dialog>` that asks "归档会话？" and names the conversation. It has 取消 and a red 归档 button. Focus starts on 取消, and Escape closes the dialog.
- 归档 disables both buttons while the request runs, and repeated clicks are ignored. On success the dialog closes, the tab closes, and a 「已归档…」 toast appears. On failure the dialog stays open with its buttons re-enabled, and a toast shows 「归档失败：<reason>」.

## Contracts and data

- GPT: the page sends the native renderer's own `mcp-request` `thread/archive` `{ threadId }` through `window.electronBridge.sendMessageFromView`. It waits for the matching `mcp-response`, with a 20 s timeout.
- Claude: `__cccTerminalConversations.request('update', { id, expectedRevision, archived: true })`, the same call as the terminal row's 归档 menu item. The result is passed to `accept`.
- No new persisted fields or console endpoints.

## Design and ownership

- `src/native-archive-button.mjs` owns the button, the dialog, and both archive calls. It is page-injected, like the other shortcut buttons.
- `src/native-conversation-tabs.mjs` wires it into the shortcut root and supplies `closeTab`, which uses the existing `close(key)`.

## Security and privacy

- There is no new trust boundary. The GPT path is the renderer's own request channel, which the native sidebar also uses. The Claude path reuses the existing terminal update contract, including the revision check.
- Archiving can be undone through restore. The confirmation dialog guards against accidental clicks.

## Rollout and rollback

- The injection VERSION was bumped to `2026-09-29.archive-button`, so re-injection replaces the older toolbar. To roll back, revert the module, the wiring, and the VERSION.

## Acceptance criteria

- [x] Enabled only for GPT and Claude conversations (`test/native-archive-button.test.mjs`).
- [x] Cancel archives nothing; confirm archives exactly once (same file).
- [x] GPT uses `thread/archive`; Claude uses `update archived:true` with the current revision; the tab closes (same file).
- [x] Failures keep the dialog and tab and show the reason (same file).

## Verification plan

- Unit: `test/native-archive-button.test.mjs`.
- Real UI: open a GPT and a Claude conversation, then archive each via the button. Confirm each disappears from the sidebar and tabs, and can be restored. Verified by the user on 2026-09-29: archiving through the button succeeded in the running app.
- Structure and regression: `npm run check`, `npm test`.

## Shipped deviations

None yet.
