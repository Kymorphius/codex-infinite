# Sidebar groups

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-28
- Related ADRs: none

## Problem

The native sidebar mixed console and native sections without a plan. Search was
split (sent-message search at the very top, project search in the middle).
ChatGPT's 聊天 section sat near the top, and user sections were scattered around
项目, 远端 and ChatGPT sections. Empty 置顶, 进行中 and 新项目 each took two
rows for placeholder text. Order values were hard-coded across eight modules
(1, 4, 5–8, 10–80, 90). ChatGPT 26 also wraps Recents in an extra drop-target
node, so its order landed on a non-flex element and it fell to order 0.

## Goals

- One order table, `src/native-sidebar-order.mjs`, defines five groups:
  1. search: project search (10), sent-message search (11);
  2. attention: 置顶 (20), 等待查看, 进行中, codex委派, 查看历史 (21–24);
  3. projects: 项目 (30), 新项目 (31), 远端 (32);
  4. user sections: 现在, 等待, 本周, 待整理, 临时 (40–44); any other user
     section shares 45 and keeps its native, user-arranged order;
  5. ChatGPT: 聊天 (50), 聊天 项目 (51), 云工作 (52).
- Every console module takes its order from that table through its injection
  builder; the native section map is serialized from the same table.
- Native section order is applied to the sidebar flex item: the ancestor whose
  parent is the sidebar scroller or a `display: contents` box.
- Empty 置顶, attention groups and 新项目 keep only their heading row. The 置顶
  hint moves to the heading's tooltip.

## Non-goals

- No visual dividers between groups, no change to native project ordering, and
  no user-configurable group order.

## Contracts and data

None. Module versions bump to `2026-09-28.sidebar-groups` (native chat section
bumps its own version) so running windows reinstall.

## Verification

`test/native-chatgpt-chat-section.test.mjs` checks the flex-item climb and that
the group sequence is strictly increasing. Module tests assert the new orders and
the missing placeholders. Visual check: injected into the running macOS app,
confirmed the section order and stability after the backend's refresh cycle,
and captured the top and bottom of the sidebar.
