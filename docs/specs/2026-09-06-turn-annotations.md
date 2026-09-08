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
never reparented. An explicit panel toggle controls a reserved right gutter and
collapses gracefully on narrow windows.

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
card is unavailable, retain a compact standalone editor as a fallback. Keep the
already accepted left-rail hover card styling and placement unchanged.

The editor collapse control is a subdued 20px square minus symbol, with an
accessible 收起批注 label and tooltip; it becomes clearer on hover/focus.
