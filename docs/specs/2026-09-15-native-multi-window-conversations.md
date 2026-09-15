# Native multi-window conversations

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-15
- Related specs: `2026-09-03-native-unified-conversation-tabs.md`

## Problem

The injected native tab strip makes several conversations easy to keep open, but
only one conversation can be visible at a time. The current Codex desktop build
already owns a native `open-in-new-window` bridge. Replacing that bridge with a
second renderer would duplicate conversation ownership and lose native behavior.

## Goals

- Add an explicit new-window action to every local Codex and native ChatGPT tab.
- Open the exact conversation in a real Codex desktop window through the native
  desktop bridge.
- Leave the source window, tab order, active tab, and conversation lifecycle
  unchanged.
- Keep invalid identities and remote conversations from reaching the bridge.
- Fail closed when the current desktop build does not expose the bridge.

## Non-goals

- Rendering or copying a conversation in Control Console.
- Persisting window positions, recreating closed windows, or synchronizing window
  layouts between devices.
- Opening remote-device conversations in a local native window.
- Closing, archiving, interrupting, or moving a conversation when its window is
  opened or closed.
- Modifying the installed Codex application bundle.

## User experience

Each local Codex or ChatGPT tab has a small window action beside its close action.
Choosing it opens that exact conversation in another native Codex window while
the source window remains where it is. The action has an accessible label and a
short visual opening state. Remote tabs omit the action because their reader is
owned by the authenticated remote-session workflow rather than a local route.

## Contracts and ownership

`src/native-conversation-window.mjs` validates the tab kind and UUID and produces
only one of these bounded messages:

```text
{ type: "open-in-new-window", path: "/local/<uuid>" }
{ type: "open-in-new-window", path: "/c/<uuid>" }
```

`src/native-conversation-tabs.mjs` owns the button and presentation state.
`src/injection.mjs` is the native renderer composition boundary and forwards the
validated message through `window.electronBridge.sendMessageFromView`. The
Control Console server, browser dashboard, session files, and remote adapters do
not participate in window creation.

## Safety

- Conversation IDs must be UUIDs and are encoded before entering a route.
- Unknown kinds and remote tabs return no request.
- The renderer sends only the fixed message type and validated path.
- Bridge absence or rejection is handled locally and does not fall back to
  `window.open`, operating-system commands, or another profile.
- Opening a window does not mutate conversation state.

## Acceptance

- [x] Unit tests cover local and ChatGPT routes plus invalid and remote inputs.
- [x] Generated injection exposes an accessible per-tab window action.
- [x] The action calls only the validated native bridge request.
- [x] The existing full repository check and test suites pass.
- [x] A live dedicated Codex profile opens the current local conversation as a
  second `app://-/index.html?initialRoute=/local/<uuid>` desktop target whose
  rendered conversation identity matches the requested UUID.
