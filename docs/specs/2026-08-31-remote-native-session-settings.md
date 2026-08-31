# Remote native session settings

## Status

Read-only display implemented and deployed to MatrixBook Air and MacBook Pro
on 2026-08-31. Native editing is specified in
`2026-08-31-remote-native-session-settings-control.md`.

## Problem

The unified remote conversation shows messages, execution, approvals, drafts,
and live turn state, but its composer does not identify the native settings that
govern the owning Codex conversation. The session list already carries model and
reasoning effort, while access mode and per-thread extended-context state remain
local to the owning node. A user supervising another Mac therefore cannot verify
the active model, reasoning strength, access boundary, or million-context switch
from the conversation screen.

## Goals

- Read the latest allowlisted native thread settings from the owning session:
  model, reasoning effort, approval policy, and active permission profile.
- Derive one bounded access mode from the native permission profile without
  exposing the complete thread-settings payload.
- Join the owning node's exact per-thread context override into its task and
  activity projections.
- Carry those fields through authenticated peer snapshots and activity reads
  with rolling-version compatibility.
- Render four compact, read-only settings in the remote composer using the same
  typography, spacing, and dark surfaces as native Codex: model, reasoning,
  access, and million-context state.
- Refresh the settings with the existing live activity poll so model or access
  changes become visible while the conversation remains open.
- Show `未记录` for unavailable values; never infer a setting from a device or
  project default.

## Non-goals

- Editing is outside this read-only phase and is defined by the follow-up native
  settings-control specification.
- Sending the complete native `thread_settings` object, developer instructions,
  system prompts, or profile definitions to another node.
- Treating an observed token count as proof that the per-thread million switch
  is enabled.
- Replacing the owning desktop's native settings controls.

## Normalized settings

The task projection adds these optional fields:

- `approvalPolicy`: bounded native policy name or `null`;
- `permissionProfile`: bounded active profile identifier or `null`;
- `accessMode`: `full-access`, `workspace`, `read-only`, `custom`, or `unknown`;
- `contextOverrideState`: `extended`, `default`, or `unknown`;
- `requestedContextWindow`: positive integer when an override exists, otherwise
  `null`.

Existing `model`, `reasoningEffort`, and `modelContextWindow` fields remain. The
latest complete `thread_settings_applied` record is authoritative for native
thread settings. `:danger-full-access` maps to `full-access`; `:workspace` maps
to `workspace`; recognizable read-only profiles map to `read-only`; another
present profile maps to `custom`; missing data maps to `unknown`.

The per-thread context store is authoritative for switch state. A present
override produces `extended` and its requested size. An initialized store with
no matching override produces `default`. If the store is unavailable the state
is `unknown`.

## Peer compatibility

The local node snapshot becomes schema version 3. Readers accept versions 1, 2,
and 3. Settings missing from an older snapshot normalize to unknown rather than
off or default. The activity schema retains version 1 and adds the same optional,
strictly validated fields so existing nodes can continue exchanging activity
during a rolling deployment.

Only allowlisted short strings and bounded integers cross the peer boundary.
Source files, complete profile objects, instruction text, and credential stores
remain excluded.

## UI

The remote composer gets a settings strip directly below its text box. It uses
four native-style, non-interactive items:

- the model slug, or `模型未记录`;
- `推理 <effort>`, or `推理未记录`;
- `完全访问`, `工作区访问`, `只读`, `自定义权限`, or `权限未记录`;
- `百万上下文 开`, `百万上下文 关`, or `百万上下文 未记录`.

The access item's tooltip may include the bounded native profile and approval
policy for inspection. The context item uses an enabled tone only when the owner
reports an `extended` override of at least 1,000,000 tokens. Other extended sizes
are labeled with their explicit size rather than called a million-context switch.

The strip remains read-only. It uses text and status semantics, not button
semantics, so the interface does not imply remote mutation support.

## Verification

- Unit tests cover thread-settings normalization, task parsing, context-store
  joining, peer version compatibility, activity validation, and UI labels.
- Static tests assert the settings strip and native-aligned styling are included.
- `npm run check`, `git diff --check`, and `npm test` pass without raising a
  structure budget.
- Browser verification opens a real MacBook Pro conversation and confirms all
  four values, native dark typography, live activity refresh, and no composer
  overflow.
- The deployed MacBook Pro `自动驾驶` conversation reported `gpt-5.6-sol`,
  `medium` reasoning, `:danger-full-access` / `full-access`, and the default
  258,400-token model window with no per-thread million-context override. The
  local conversation rendered these as `gpt-5.6-sol`, `推理 medium`, `完全访问`,
  and `百万上下文 关`.
- Browser measurements confirmed four 12 px / 16 px native-metadata items and
  a 760 px settings row with equal client and scroll dimensions.
- The complete suite passed 179 tests. Syntax and structure checks passed for
  133 and 150 files respectively, with zero frozen structural debt.
- SHA-256 hashes for every deployed source, UI, and style file match between
  MatrixBook Air and MacBook Pro after restarting only the two control services.

## Rollback

Remove the optional task/activity fields and settings strip. Older peer schemas
and all conversation execution behavior remain valid; no native state is changed.
