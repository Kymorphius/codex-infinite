# Preserve native Chat / Work choice when starting project tasks

The project search alias fallback used a raw home-route message. This bypasses native new-task initialization, including resetting the current sidebar conversation and preparing the composer. Replace that fallback with the full native start action. Existing mounted project buttons continue to invoke their exact native button. Ordinary native buttons and mode preferences are never rewritten or intercepted.

The adapter reads the native sidebar new-task component's scoped runtime and resolves one loaded native start export by its complete initialization contract. It fails closed when native structure is unavailable or ambiguous; never substitute a raw route or send a prompt. The start receives only activeProject identity and does not force Chat or Work. Native owns all draft lifecycle and rendering.

Verification: reproduce raw-route behavior; full native initialization must show both Chat and Work. Tests cover loaded native action resolution, project identity forwarding, unavailable/ambiguous adapter rejection, and no route-only fallback. Run full checks and tests.

## Validation evidence
Mac native runtime: full project start shows visible 聊天 and 工作 controls. Returning to a conversation and clicking the untouched native 新聊天 button also shows both controls. Full checks and all 498 tests pass. Windows deployment was unavailable because SSH to the existing device endpoint timed out; no Windows completion is claimed.
