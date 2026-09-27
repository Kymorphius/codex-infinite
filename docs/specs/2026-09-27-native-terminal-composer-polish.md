# Native terminal composer polish

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-27
- Related ADRs: 0029

## Problem

The terminal conversation rendered in the native macOS workspace
(`src/native-terminal-view.mjs`) used a rough composer. Its fixed-height textarea
never grew. Status text sat between generic key buttons with no state color. The
send glyph was a text character. The header showed only the title, and the view
exposed fewer terminal keys than the loopback dashboard composer.

## Goals

- The header shows the title, a kind chip (hidden when it repeats the title) and a
  shortened working directory; the start action is a primary pill that appears only
  when the session is not running.
- The composer grows from one line to 200px and shows a hint only while focused.
  It offers 打断 (Ctrl+C), Esc, and an upward 更多按键 menu with Enter, ↑, ↓, Esc,
  Tab, Ctrl+D, plus 仅粘贴 (paste without Enter).
- Status shows a toned dot (connected, connecting, error, idle). Action errors stay
  visible until the next successful key or submit.
- Send and key controls are disabled whenever the session cannot accept input;
  send is also disabled for an empty draft.
- The view owns the whole native main pane. ChatGPT 26 narrows `role="main"` to
  the home composer and renders the 聊天/工作 mode toggle as its sibling, so the
  host is the nearest `[data-app-shell-focus-area="main"]` ancestor of that main
  element (many unrelated nodes share the attribute; never query it globally).
  It falls back to the main element when no usable ancestor exists.
- While mounted, the view sets the main surface's reserved 36px page-tab inset to
  zero (inline, important) so the title row takes that space; disposal restores
  the previous inline value. Other native pages keep the inset.
- Colors inherit native theme tokens through the shadow root with dark fallbacks.

## Non-goals

- No task-center (存待办/待办/领任务) controls in the native view yet.
- No stop action; stopping stays in session management.
- No transport, contract or Windows iframe changes.

## Contracts and data

None changed. Paste-only uses the existing `pasteText(text, { submit: false })`;
keys use the existing `sendKey` set. The draft key stays `terminal-draft:<id>`.

## Design and ownership

`src/native-terminal-view.mjs` owns layout and interaction.
`src/native-terminal-view-style.mjs` owns shadow-root CSS. `src/native-terminal-runtime.mjs`
appends it to the xterm CSS and includes it in the injection version hash, so style
changes reinstall the runtime.

## Verification

`test/native-terminal-view.test.mjs` covers empty-draft disabling, submit with
Enter, paste-only, key error notice and recovery, and host restoration. Visual
check: injected into the running macOS app over CDP, then captured the header,
the collapsed and expanded key menu, and three-line autogrow at 1280×802.
