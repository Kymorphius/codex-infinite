# Native ChatGPT chat section

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-09-01
- Related ADRs: none

## Problem

The native sidebar's `Recents` section mixes projectless Codex tasks, ordinary
ChatGPT conversations, and ChatGPT cloud work. It also keeps showing ordinary
chats after they have been assigned to a ChatGPT project, so classification
does not reduce the recent-list noise. ChatGPT projects now occupy their own
top-level custom section, but unassigned chats remain visually submerged in
the mixed recent list. Hiding Codex rows inside this native list also leaves
blank slots because the native list keeps its own item geometry.

## Goals

- Present the native `Recents` section as a top-level `聊天` section.
- Present the native Codex projects section as `项目` immediately
  above `待整理`.
- Present the custom ChatGPT project section as `聊天 项目` immediately above
  `聊天`, with `云工作` immediately above it.
- Keep native list geometry continuous; never hide only the inner row while
  leaving its owning list item in the layout.
- Present ChatGPT cloud work under its own top-level `云工作` label while
  preserving the native rows and click behavior.
- Keep the native `Recents` refresh spinner on the same line as the `聊天`
  heading instead of reserving a standalone loading row.
- Keep the section parallel to the top-level ChatGPT `项目` section; do not
  create a nested hierarchy.
- Preserve native expansion, collapse, navigation, ordering, and live updates.
- Never paint an unclassified native recent row before its project/cloud-work
  classification is known.
- Allow one native recent-list bootstrap per renderer build, then prevent user
  disclosure actions and hidden-list geometry from requesting additional mixed
  recent pages.
- Automatically include newly rendered, projectless ordinary ChatGPT
  conversations.
- Suppress project-assigned ChatGPT conversations from `聊天` because they are
  already available through `项目（聊天）`.
- Restore the presentation automatically when the native renderer rebuilds its
  sidebar without changing the CDP target id.

## Non-goals

- Moving, cloning, deleting, archiving, pinning, or changing ChatGPT
  conversation data.
- Reparenting React-owned rows or changing the native section's persisted key.
- Hiding Codex tasks outside the native `Recents` section.
- Changing ChatGPT project membership or the native recent-activity data.
- Intercepting or blocking ChatGPT network requests.

## Design

`src/native-chatgpt-chat-section.mjs` recognizes only the native section whose
stable heading key is `Recents`. It changes the visible localized title to
`聊天`. Existing projectless Codex tasks are moved to the native custom
`临时` section through the supported sidebar mutation interface. Codex tasks
that already belong to projects retain that project association; their entire
native `role=listitem` wrapper is collapsed only in `Recents`, so they do not
duplicate project content in `聊天` and do not reserve blank geometry.

ChatGPT list items expose a stable conversation-key attribute and a native
semantic suffix: `聊天` for ordinary conversations and `工作` for cloud work.
The React-owned `chatGptSource.chatTargets` collection supplies each ordinary
conversation's native `projectId`. The injection uses that read-only value to
collapse the owning list item when the chat already belongs to a project. A
missing target fails open and remains visible, so renderer-version drift cannot
make an unclassified chat disappear.

A persistent, injection-owned style hides only ChatGPT recent rows that do not
yet carry a classification marker. The mutation observer classifies every new
row synchronously in one animation-frame callback and marks it before it can be
revealed. Ordinary unassigned chats are then shown together; project chats and
cloud work remain hidden. This prevents the native full recent list from
flashing and disappearing row by row when the section expands or refreshes.

The native `Recents` list is retained as a hidden data owner. If it is collapsed
when a renderer is first instrumented, the injection performs one native
expansion to obtain the base page, then records that bootstrap on the section.
Afterward, a capture-phase disclosure handler owns user clicks: it toggles only
an injection-owned ordinary-chat proxy list and never calls the native toggle.
The hidden native list cannot expose its pagination sentinel to layout, so
scrolling the sidebar cannot request additional mixed recent pages. Proxy rows
use the native conversation route and do not expand or refresh `Recents`.

The native sidebar mutation contract rejects ChatGPT conversation keys, so a
dedicated empty custom section named `云工作` supplies the top-level disclosure
while native `Recents` remains the data owner. The injection caches a bounded
key/title projection, hides the cloud-work source list item as a whole, and
renders native-styled title proxies in `云工作`. Activating a proxy uses the
native ChatGPT `/c/<conversation-id>` route directly, so it never expands or
refreshes `聊天`; conversation content and controls are not copied. A mutation observer
reapplies the projection after native renders. Original presentation values and
title text are retained for version replacement.

The primary-owner bridge re-evaluates the version-guarded native injection
sources on every synchronization poll before publishing snapshots. This is a
health check, not a second data owner: a healthy chat observer reruns its
bounded apply function, while a renderer or sidebar rebuild that discarded
window state receives the full injection again even when its CDP target id did
not change. The observer includes character-data changes because native
localization can replace only a heading's text node without replacing its
section or attributes.

The same injection applies CSS flex order to the native section wrappers. This
places `项目` above `待整理` and keeps `云工作`, `聊天 项目`, and `聊天`
without reparenting React-owned nodes. Original inline order values are retained
for rollback.

`聊天` and `云工作` each have one top-level disclosure control. Neither section
adds a second disclosure level.

When the native `Recents` list renders its transient spinning list item, the
injection preserves the spinner node but positions the owning list item beside
the `聊天` heading. The loading item leaves normal list flow, so expanding or
refreshing the section does not create a centered blank loading row.

## Acceptance criteria

- [x] Project and chat areas appear as parallel top-level sections.
- [x] `项目` appears immediately above `待整理`.
- [x] The final three sections are `云工作`, `聊天 项目`, and `聊天`, in that
  order.
- [x] The native `Recents` section visibly reads `聊天`.
- [x] ChatGPT ordinary conversations remain visible and use native navigation.
- [x] Project-assigned ChatGPT conversations do not duplicate their project
  entries in `聊天`.
- [x] Projectless or temporarily unrecognized ChatGPT conversations remain
  visible in `聊天`.
- [x] Expanding or refreshing `聊天` never flashes project chats or cloud work
  before filtering completes.
- [x] After one renderer bootstrap, toggling `聊天` changes only the projected
  ordinary-chat list and does not invoke native recent refresh or pagination.
- [x] The implementation does not intercept network traffic or suppress the
  application's initial shared-data synchronization.
- [x] Projectless Codex tasks are moved to `临时` through the supported sidebar
  interface.
- [x] Project-associated Codex recents collapse at the owning list-item level,
  so the native list has no blank slots.
- [x] ChatGPT cloud work is grouped under a separate top-level `云工作` label.
- [x] `云工作` appears immediately above the bottom `聊天` section.
- [x] The native refresh spinner appears beside `聊天` without adding list
  height.
- [x] Opening a cloud-work proxy does not expand or refresh `聊天`.
- [x] New ChatGPT renderer rows are classified automatically.
- [x] A same-target renderer/sidebar rebuild restores `聊天`,
  `项目（Codex）`, sticky headings, and row filtering on the next owner sync.
- [x] No native row is moved, cloned, or deleted by the injection.
- [x] Both dedicated and primary native injection paths install the behavior.
- [x] `npm run check` and `npm test` pass.

## Verification

- Source/unit: exact `Recents` matching, native conversation-key matching,
  semantic cloud-work classification, order restoration, mutation recovery,
  and absence of conversation-row reparenting or inner-row hiding.
- Integration: both injectors install the source.
- Live read-only inspection: section label, top-level geometry, visible row
  kinds, and native toggle preservation.

## Rollback

Remove the injection from both paths and reload the renderer. The native
`Recents` label and all native rows return without data migration.

## Shipped evidence

- Sidebar state contains 28 native Codex projects, 17 `待整理` tasks, 178
  `临时` Codex tasks after 151 additional projectless tasks were classified,
  and 34 `项目（聊天）` projects.
- Live computed geometry showed the exact top-level order: `现在`, `等待`,
  `本周`, `项目（Codex）`, `待整理`, `临时`, `项目（聊天）`, `聊天`.
- The native stable keys remain `Projects` and `Recents`; only visible labels,
  CSS order, and the bounded cloud-work title projection change. Codex recent
  list items and projected cloud-work source items collapse as a whole.
- The native move attempt for a ChatGPT cloud-work conversation was rejected as
  a non-Codex thread, confirming that the projection fallback is required.
- Twelve current cloud-work conversations appear in the independent `云工作`
  section, ordered above `聊天`; `聊天` remains the bottom section.
