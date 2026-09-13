# Native conversation turn annotations

Provide a collapsible right-side 批注 panel in each dedicated native console.
Bind notes to the rendered local conversation UUID and stable native turn UUID,
never array position or the selected tab label. Resolve the conversation from
read-only native React ancestry of the visible conversation content; decline
unknown/remote identities. The native rail's turn:message IDs map to the same
turn note, including multiple user messages within a turn. For short threads
without a rail, read mounted data-turn-key anchors and allow selection there.

The panel lists turns, edits one plain-text note per turn, autosaves, and clearly
reports pending/saved/failure state. Switching turns or conversations preserves
pending drafts. Empty text deletes the note. Backend files live under the wrapper
profile annotations directory, use validated UUID paths and atomic replacement,
and never change native sessions, project membership or unread state. Pending
browser edits persist in localStorage until explicitly acknowledged by the
backend; storage errors are visible. Serialize writes and retain unrelated turns.
Do not send annotations to the model. Each device owns its annotation files.

Decorate existing rail hosts with an owned data attribute and CSS only: annotated
markers become purple. On hover/focus show a separate plain-text annotation card
directly below the native preview with a 4px gap, matching its width and native
card classes (background, font, padding, radius, ring and shadow). Reserve the
annotation height on the existing native card host so native floating placement
can keep both cards within the viewport. Remove the reservation on dismissal,
without replacing the native tooltip or intercepting its navigation. Panel turn
selection and native rail clicks agree. Keep editor focus and text stable during
background DOM updates. Own DOM islands are removable; native React children are
never reparented. An explicit panel toggle collapses gracefully on narrow windows.

Use separate pure validation, file storage, CDP synchronization, native identity
adapter, panel rendering/style modules. CDP synchronization targets the exact
app://-/index.html page and has no HTTP mutation endpoint. Batch only pending
annotation actions, acknowledge exact action IDs, reject oversized/invalid data,
and retry safely after failures. Never log note text. Tests cover persistence,
turn/thread isolation, deletion, corrupt files, ordering, save acknowledgements,
identity extraction, marker mapping and generated injection syntax. Run check and
full tests, then narrowly deploy both machines and inspect native loaded state.

## Right-side card placement correction

The editor itself is a card immediately below the native 输出内容/来源 card,
matching its width, background, radius and elevation with the native 12px gap.
It shares the existing right column and does not reserve a second content gutter.
A collapsed editor remains a compact 批注 card in that position. Bound the native
output card height through an owned host attribute so its existing scroll area
can leave space for the editor. Never move React children. If the native summary
card is unavailable or dismissed, hide both the editor and its collapsed card;
the annotation control never falls back to an independent fixed overlay. Keep
the already accepted left-rail hover card styling and placement unchanged.

The editor collapse control is a subdued 20px square minus symbol, with an
accessible 收起批注 label and tooltip; it becomes clearer on hover/focus.

## Control workspace visibility

Annotation panels, collapsed cards, previews and turn rails belong only to a
rendered native conversation. When a Codex Control Console workspace overlay is
present, hide every annotation surface immediately and release its reserved
layout gutter. This presentation guard must apply before the next polling or
DOM-refresh cycle so a card positioned from the previous conversation cannot
cover an embedded board, project page or other console module.

Codex browser tabs are separate renderer surfaces and do not add the workspace
overlay marker to the native conversation document. The owner therefore also
checks same-origin dashboard page targets and suppresses annotations while one
of those pages has a visible document and non-zero viewport. Background dashboard
tabs with no rendered viewport do not suppress the native conversation after the
user returns to it; an unreadable matching target fails closed by keeping
conversation-only controls hidden.

Verification on 2026-09-13: the focused annotation and synchronization tests
cover workspace overlays, separate visible browser surfaces, hidden browser tabs
and output-card-only placement. The restarted local control service attached to
the dedicated renderer and loaded the upgraded presentation controller. The full
suite passed 645/645; syntax and structure checks passed for 399/429 files. Live
renderer measurement confirmed the collapsed control matches the native output
card's 240px width, sits 12px below it, and returns to a hidden zero-size state
while the conversation board browser surface is displayed.
