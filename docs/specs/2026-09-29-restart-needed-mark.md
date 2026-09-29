# Restart-needed mark for conversations

## Problem

A conversation sometimes only picks up new config, skills, MCP servers or plugins
after the whole app restarts. Nothing tells the user which conversations they
flagged for that, so they are forgotten or restarted blindly.

## Behavior

- Each row in 最近会话 and 最近发送 has a small toggle button (shown on hover or
  focus, always visible while marked). Clicking marks the conversation as
  "needs restart"; clicking again removes the mark. The button is a
  restart glyph; when marked it stays visible, is tinted, and its tooltip reads
  `需要重启 · 标记于 <time>（点击取消）`.
- Marks are manual. There is no automatic marking: nothing in the console can
  tell reliably that a conversation is stale, and a wrong automatic mark is
  worse than none.
- A mark has a status: `restart` (needs restart) or `verify` (待验收). When the
  whole dedicated app restarts after a `restart` mark was set, it converts to
  `verify` with a `restartedAt` time instead of disappearing, so the user can
  check whether the conversation now meets its acceptance requirements.
  Restarting only a conversation, its terminal, or reloading the page changes
  nothing.
- A `verify` mark ends by the user's decision: `已验收` removes it; `未通过`
  returns it to `restart` (marked now, against the current app instance). A
  later app restart never removes a `verify` mark.
- The row button cycles: none → `restart` → none; on a `verify` row a click
  means `已验收`. Its glyph and tint differ per status (orange restart, blue
  check for verify).
- The top-left of the native sidebar has a `需求` icon button with a count
  badge (hidden at zero). It opens a panel listing every marked conversation
  (title, engine, marked-at time). Clicking a row opens that conversation;
  the panel has two groups, `需要重启` (button `取消标记`) and `待验收`
  (buttons `已验收`, `未通过`). The badge counts both; it is tinted blue when
  only `verify` marks exist. Empty state: `暂无需要重启或待验收的会话`.
- Applies to native Codex (`local`) and Claude CLI (`terminal`, non-shell)
  conversations. ChatGPT, remote and shell conversations show no toggle.

## Design

- `src/restart-mark-contract.mjs` (domain): normalization, id/limit rules
  (conversation id, provider, title ≤160, ISO `markedAt`, ≤200 marks),
  `reconcileMarks(state, appInstance)`.
- `src/restart-mark-store.mjs` (adapter): atomic JSON file
  `restart-marks.json` under wrapperCodexHome, mode 0600. Shape
  `{ version: 1, appInstance, marks: { <id>: { id, provider, title, markedAt, status, restartedAt? } } }`.
- `src/app-instance.mjs` (adapter): identity of the running dedicated app =
  pid plus process start time (`ps -o lstart=` on macOS, pid alone elsewhere),
  cached for 5 s. Unknown identity never clears marks.
- `src/restart-mark-service.mjs`: `snapshot()` reconciles against the current
  instance first (different known instance ⇒ convert `restart` marks to `verify` and adopt
  the new instance); `set({id, provider, title, marked})` and `resolve({id, outcome})` (`passed` | `failed`) records the current instance
  when the first mark is written.
- `src/native-restart-marks.mjs`: CDP binding `__codexControlConsoleRestartMarksBridge`
  (request `{id, kind: "list"|"set"|"resolve", …}`, response through
  `window.__codexControlConsoleResolveRestartMarks`) plus the page-side store
  used by the recent menus and the sidebar panel. Requests are validated
  strictly; mutations arrive only through the CDP binding, which is bound to the
  console-owned page, so the loopback / exact-origin invariants are unchanged.
- Page UI: toggle button and mark in `native-recent-conversations.mjs` via a
  small helper in `native-recent-restart-mark.mjs`; the sidebar button and
  panel in `native-restart-needs-panel.mjs`. Both read the page-side store and
  re-render on its change event.
- Injectors register the binding through one generic `extraBindings` option
  (`{ name, handle(payload, connection) }`) so `injector.mjs` and
  `native-owner-injector.mjs` gain no product logic. The duplicated
  `Runtime.addBinding` block in `injector.mjs` is folded into one helper to stay
  inside its structure budget; no budget is raised.

## Safety

- Read-only with respect to native Codex state; only console-owned
  `restart-marks.json` is written.
- No credentials, paths or prompt text in marks; titles are control-character
  stripped and truncated.

## Verification

- Contract tests: normalization, limits, reconcile with same/different/unknown
  instance.
- Store tests: atomic write, corrupt file yields empty state.
- Service tests: set/unmark, restart drops marks, unknown instance keeps them.
- Binding tests: strict request parsing, response script.
- Recent-menu tests: toggle button per eligible row, mark shown, ineligible
  kinds have no button.
- Panel tests: badge count, list, jump, unmark, empty state.
- `npm run check` and `npm test`; visual check in the dedicated window when
  desktop access permits.

## Non-goals

- Automatic marking; restarting conversations from the panel; syncing marks
  across devices.
