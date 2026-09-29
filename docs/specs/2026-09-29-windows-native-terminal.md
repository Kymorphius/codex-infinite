# Windows native terminal view

- Status: accepted
- Owner: Windows node maintainer
- Date: 2026-09-29
- Related ADRs: none

## Problem

The native terminal transport and view were limited to macOS with `!reloadAfterCspBypass`
(a stand-in for "not Windows"). Windows fell back to the iframe terminal page, and on the
Windows shell that produced, as observed on 2026-09-29:

- switching from a ChatGPT conversation to a Claude CLI conversation showed an empty dark
  area under the previous conversation's title and native actions (the reported
  "transparent layer");
- no 分屏 (split review) or 重绘 (redraw) buttons, which exist only in the native view;
- the 聊天/工作 mode toggle and a second title row took vertical space in the terminal page.

Two further Windows-only defects surfaced once the native view ran there:

- the injector prepared the runtime before the CSP reload, so the replaced document
  installed the provider without it and stayed on the iframe transport;
- the Windows header is `position: fixed` over the page, so terminal output was painted
  under the title bar (macOS lays the header out in flow).

## Goals

- Windows shows the same native terminal view as macOS: title in the native header slot,
  split and redraw buttons, native composer, no stale conversation title.
- Terminal output starts below a pinned header on any platform.

## Non-goals

- Changing native header actions outside the terminal view. While the terminal
  owns the view, unrelated native header actions and the home mode toggle are
  hidden; leaving restores them.
- Removing the iframe transport; it remains the fallback when the runtime is absent.

## User experience

Opening a Claude CLI conversation on Windows replaces the main page with the native
terminal: the header shows `Claude CLI · <cwd> · 启动会话 · 分屏 · 重绘`, output begins
below the header, and the composer offers 打断 / Esc / 更多按键. Returning to a native
conversation restores its header and page unchanged.

## Contracts and data

- `installIntoTarget(..., { beforeInjection })`: optional async hook awaited immediately
  before every injection-script evaluation (fresh and already-installed paths).
- No persisted data or HTTP contract changes.

## Design and ownership

- `src/injector.mjs`: installs the terminal binding on every platform and passes
  `beforeInjection: () => prepareNativeTerminalRuntime(connection)`, so the runtime exists in
  the document the provider is installed into, including after a Windows CSP reload.
- `src/native-terminal-runtime.mjs`: unchanged behavior; documents the ordering contract.
- `src/native-terminal-view.mjs`: `headerInset()` pads the layout by the overlap of a
  `fixed`/`absolute` native header (0 for an in-flow header), recomputed on resize and on
  header placement.

## Security and privacy

No new trust boundary. The binding keeps its checks: only the top-level `app://-` context
may call it, requests are bounded, streams are keyed by execution context and token.
Windows already enables CSP bypass; nothing new is loaded from loopback into the renderer.

## Rollout and rollback

Takes effect on the next service start (the dedicated shell is re-injected). Roll back by
restoring the `!this.reloadAfterCspBypass` conditions in `src/injector.mjs`; the provider
then falls back to the iframe transport automatically.

## Acceptance criteria

- [x] Windows (CSP reload mode) registers `codexControlConsoleTerminal`.
- [x] The runtime is prepared after the CSP reload and right before each injection.
- [x] A pinned header reserves its height; an in-flow header reserves nothing.
- [x] On the real Windows shell: split/redraw visible, stale title gone, output below the
      header, and switching back to a ChatGPT conversation restores its header.

## Verification plan

- Unit: `test/injector.test.mjs` (binding on Windows, runtime ordering),
  `test/native-terminal-view.test.mjs` (header inset). Each fails on the previous code.
- Real UI: patched runtime and binding installed into the live Windows shell over a separate
  CDP session with the service proxied; screenshots before and after.
- Structure and regression: `npm run check`, `npm test` on Windows.

## Shipped deviations

None.
