# Automatic new-project sidebar section

## User outcome

Add 新项目 before 项目 (after 本周). This is an additional local-project view:
a project continues to appear in all its original native categories. Never move
native items or change their section membership. Use native heading typography,
transparent background, and keyboard-accessible disclosure rows. This special
automatic section cannot be dragged into or out of: it registers no native
sortable/droppable identities, disables HTML drag, rejects drops and isolates
pointer-down events from native drag sensors. Disclosure/navigation remain usable.

Eligibility lasts from the native project's creation time until either seven
24-hour periods elapse or it is observed in the top ten scored projects under the
existing project-priority policy. Graduation is permanent, including across
restarts and later rank drops. Existing projects younger than a week qualify;
legacy mapped creation dates take precedence over newer migration registration dates;
unknown/future creation dates are excluded, not treated as newly created. Projects
without tasks have no score and cannot graduate merely by filling empty top-ten
slots. Rank ties follow the existing deterministic priority ordering.

## Design

- Pure domain policy accepts normalized projects, ordered scores, prior lifecycle
  records and a clock. Output includes additional project views and persisted
  graduation records. Expiry uses >= seven days; top-ten includes rank ten.
- A filesystem/App Server adapter pages project/list read-only, reads local task
  snapshots and uses existing priority scoring. Store graduation atomically in a
  private console JSON file, never in native SQLite or native section atoms.
  Cache/coalesce reads for 60 seconds; on read failure retain only unexpired
  last-known views and retry after a bounded delay. Unavailable data must not
  create graduation. Persistence failure must not publish unpersisted graduation.
- A dedicated injection module renders a console-owned sidebar island beside
  native section wrappers without cloning/moving native React-owned children.
  Project disclosure exposes local task shortcuts through existing native task
  routes. Render plain-text names and titles. No credentials or filesystem paths
  enter browser state. Copy native CSS classes for headings/rows; no background
  paint. Local section/project expansion persists in localStorage.
- Wire the provider into dedicated and optional primary injectors. Each host
  computes local ranks independently. UI drops expired entries even if the next
  backend refresh fails. Normal automatic refresh delay is at most 60 seconds.

## Validation

Test week boundary, rank ten/eleven, ties through existing policy, no-task projects,
unknown/future dates, permanent graduation on restart, pagination, single-flight
reads, failed reads/writes, and no native membership mutation. Test generated
script with a DOM harness for simultaneous native/project alias rendering,
keyboard disclosure, navigation, empty section, rerender idempotence and expiry.
Run npm run check and npm test; deploy to Mac and Windows own consoles and inspect
live section/style, normalized provider data and original native membership.

## Shipped verification (2026-09-05)

- Local syntax/structure checks passed (243/263 files); all 376 tests passed.
- Windows syntax/structure passed; all 19 focused policy, provider, injection and
  lifecycle tests passed, including drag rejection and disposed-render cleanup.
- Deployed to both dedicated consoles. Live version 2026-09-05.3 has exactly one
  automatic root per window, order 35, draggable=false. Heading text computed
  font size/weight/color and transparent background match native 项目 exactly.
- Mac currently has no eligible projects; Windows has six. Native sections and
  native project-row counts remain present (Mac 7, Windows 84 across sections).
  Real pointer/keyboard gestures were covered by button semantics and the DOM
  harness, not manually exercised against the user's active native window.
- Legacy creation metadata prevents upgraded older Mac projects from appearing
  as new. No native section membership is written by this feature.

## Style and creation follow-up

Match the native section padding, SVG disclosure, folder leading slot and project
name typography, rather than merely font/color. Add a native-style plus button
at the right of the heading, available when the native project-create trigger
is available. Delegate its click to that native trigger; do not duplicate the
creation flow or manually force membership. Preserve the automatic classification
and drag restrictions.

Style follow-up verified: version 2026-09-05.5 deployed to both own consoles.
Local checks and all 378 tests passed; six Windows renderer regression tests
passed. Live readback confirms one root, native 8px section padding, identical
native create-button classes and 24px height, enabled plus action, SVG disclosure,
and draggable=false. The creation handler is tested against the native trigger;
no actual project was created during verification.
