# Native sidebar entry placement after the ChatGPT update

## Evidence and problem

The user's current screenshot shows 控制台、会话中心、项目优先级 in the
far-left icon rail, with oversized inherited labels. 看板 has been moved into the
text sidebar below 任务清单 but keeps its icon-rail styling, so its icon and label
stack vertically. The earlier static layout audit did not distinguish these two
navigation surfaces; this screenshot establishes the rendering failure.

The current package defines `nav[data-app-navigation-rail]` for icon navigation,
and `#app-shell-sidebar [data-slate-sidebar-content]` for the text pane. Top
actions are outside the lower `[data-app-action-sidebar-scroll]` container. The
native New-chat action has an inner flex row, a leading-icon slot, and a truncated
label; cloning only the outer button classes does not reproduce that structure.

## Required behavior

- Resolve the visible text-sidebar action anchor, preferring its native New-chat
  row. Never select an icon-rail button or a console-owned injected control.
- Revalidate cached anchors after a pane remount or a move into the rail. Closed
  or inert panes do not receive entries. Retain the legacy Apps/Sites/Scheduled
  action-row fallback outside the rail for supported older layouts.
- Place all four console module entries in the same text action group, in order:
  看板、控制台、会话中心、项目优先级, after the existing 任务清单 when it shares
  the same group, otherwise after New chat. Keep 新聊天、管家、打开本地项目、任务清单
  and all original native navigation intact.
- Build a native-like horizontal row with one icon slot and one label slot,
  inheriting the native action's font, row sizing, colors, and interaction classes.
  Preserve single-line labels and keyboard focus at narrow sidebar widths.
- Repair existing injected entries in place when possible, preserving click
  routing and avoiding duplicate buttons or mutation-driven reordering loops.
- Advance the outer injection identity so installed old entries are cleaned up
  and migrated by the normal injection lifecycle after backend reload.

## Design basis and scope

This is an Electron sidebar integration fix, not a native sidebar redesign.
`apple-design` references `layout.md` (Visual hierarchy), `sidebars.md`
(Best practices and Desktop), and `cross-platform.md` support consistent
alignment, grouped navigation, and native-sized glyph/label rows. Existing
native semantic colors and typography remain authoritative; no new palette,
status data, or independent navigation state is introduced.

No native app-resource modifications, credential/session writes, safety-boundary
changes, live UI/CDP automation, or unrelated concurrent-feature commits.
Computer Use still denies access to the native app. Supplied screenshots and
static package contracts can guide the repair; actual updated-window acceptance
must remain separate from tests and backend health.

## Acceptance

1. Fixtures containing both the rail Apps action and the textual New-chat action
   select only the textual action, without ordinary layout reads.
2. Cache remount, rail-only, hidden/inert, and legacy action-row cases are covered.
3. Existing misplaced entries migrate into the text group with horizontal icon
   and label structure, stable order, unchanged routing, and no duplicates on
   repeated installation. Original rail and sidebar controls stay untouched.
4. `npm run check` and `npm test` pass; owned changes are committed separately.
5. Activate through the authorized backend reload, check runtime/catalog health,
   and report the remaining updated-window visual acceptance limitation.

## Verification and delivery status

- Fresh read-only review found no required corrections in the anchor, grouped
  installer, callback preservation, normalized DOM/CSSOM comparison, or injection
  identity changes.
- `npm run check` passed: 835 syntax files, 69 module-graph modules, and 877
  structure files. The injection composition stays within its 350-line budget.
- `npm test` passed: 1802/1802, including rail/text-pane selection, hidden and
  remounted panes, in-place migration, unrelated checklists, duplicate repair,
  preserved click routes, and zero repeated DOM writes after SVG serialization.
- Activation is pending a safe backend reload. The currently running service
  still reports one running terminal, created after the previous reload was
  completed. Reloading the backend disposes that terminal; this impact needs
  current scoped authorization before activation.
- Updated native-window visual acceptance remains pending; automated UI access
  to the native app is denied. Tests do not establish the final rendered result.
