# Native project priority order

## Context

The desktop app persists local project order as an app-server `position`. The order is stable but does not follow recent conversation activity. The control console already computes a bounded 100-point project priority from recency, recent session count, and runtime, but that score currently appears only in the console's read-only priority view.

The current app-server protocol provides `project/list` and `project/move`. This makes it possible to persist a native order without manipulating React-owned DOM or writing SQLite directly.

## Goals

- Order native local Codex projects by the existing project-priority score.
- Put recently discussed projects first.
- Preserve the original relative order of projects without readable conversations.
- Use the official native app-server project protocol rather than DOM or database writes.
- Apply the order before the dedicated wrapper app launches so its first render is stable.

## Scoring and matching

- Windows compatibility repair (2026-09-05): normalize drive paths and UNC
  paths with or without the `\\?\` extended-length prefix before containment
  matching. Select Windows/POSIX path semantics from the path, independently of
  the host running the calculation. Reject relative paths and cross-platform
  matches; preserve directory boundaries and longest-root precedence.
- Live Windows evidence: the latest 160 native threads matched zero projects
  before removing their extended-length prefix, and 153 after normalization.
  Regression coverage must exercise these paths on both macOS and Windows.

- Reuse `calculateProjectPriority` unchanged: latest-conversation recency contributes up to 70 points, the seven-day session count up to 15, and runtime up to 15.
- Match a conversation to the project with the longest root path containing its working directory. This supports multi-directory projects and avoids ambiguous parent-directory matches.
- Sort matched projects by score, then latest conversation time, then existing native position.
- Append unmatched projects in existing native position order.

## Native mutation contract

1. Start a short-lived app-server process with the wrapper `CODEX_HOME`.
2. Initialize experimental protocol support and page through `project/list`.
3. Compute the desired order from read-only session metadata.
4. If the order changed, call `project/move` from the end of the desired list toward the start, always placing the next project before the current anchor.
5. Reorder the wrapper's legacy `local-projects` bootstrap object using its existing legacy-to-app-server id mapping. The current desktop release still uses this insertion order for the first sidebar render even after app-server migration.
6. Shut down the short-lived process before launching or attaching the native wrapper.

Because the native project database is deliberately shared, the persisted order is the real local order and is visible to both the ordinary and wrapped Codex apps on this node.

## Safety

- Do not modify project roots, names, files, conversations, or credentials.
- Do not write SQLite directly.
- Change only wrapper project key order in global state; do not copy or mutate project content during ordering.
- Do not reorder GPT cloud projects in the separate ChatGPT project section.
- Fail open for wrapper startup: if ordering is temporarily unavailable, log the issue and continue launching with the last native order.
- Bound protocol requests with timeouts and reject malformed responses.

## Verification

- Unit tests cover multi-root matching, nested-root precedence, score ordering, stable unmatched ordering, protocol paging, and native move sequencing.
- `npm run check` and `npm test` pass.
- A clean wrapper restart shows the highest-weight local projects first; `看板` is near the top when its current conversation is most recent.
- No project-rank attributes or native project DOM movement return to the injection layer.
