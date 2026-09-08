# Visible empty pinned section

The dedicated profile has no pinned entries and native UI omits its pinned
section; source-profile pins overlap projects intentionally assigned to 等待 in
the dedicated profile. Do not silently reassign or copy their pin state.

Render a native-style console-owned empty 置顶 section when the native pinned
section is absent. Explain that users can right-click a project/conversation and
select pin. As soon as native Pinned/置顶 renders, remove the placeholder, retaining
the native pin/drop behavior. Never register the placeholder as a drop target or
move native children. Place both native and empty pinned sections at order 1, above search and all other sections.
Validate absence/presence detection, idempotency, native styling, and disposal.
Run check/tests and deploy both consoles with read-back evidence.
