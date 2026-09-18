# Native composer held queue

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-17
- Related specs: `2026-08-30-federated-remote-messaging.md`, `2026-09-17-dispatch-queue-order-and-held-messages.md`

## Problem

The native composer can send immediately, steer an active turn, or append a
follow-up to the app-server queue. App-server queued follow-ups execute
automatically and the native client can temporarily retain a stale queue item,
which surfaces as `App-server queued follow-up no longer exists`.

Users need a fourth composer workflow: move a queued follow-up into a durable
todo state that never executes automatically, reorder both kinds of pending
messages, and explicitly resume a held item later.

## Goals

- Put pending-message management next to the native composer.
- Let the current text draft be saved directly as a held todo without first
  entering the executable queue.
- Read, delete, add, and reorder executable items through the native
  `thread/queue/*` app-server contract.
- Pause by saving the complete queued submission locally before deleting it
  from the executable queue.
- Keep held items indefinitely and require an explicit resume action.
- Provide a recovery path when the native queue view has a stale app-server id.

## Non-goals

- Changing Codex app-server queue semantics.
- Automatically resuming held messages when a turn completes.
- Sharing held records between machines. They belong to the machine that owns
  the native session and queue.
- Treating dashboard dispatch records and native follow-ups as the same storage
  record. They share the same lifecycle language and safety rule, but retain
  their existing execution authorities.

## User experience

The native composer toolbar exposes `存为待办` and `待发管理` with executable
and held counts. `存为待办` saves the current text draft locally without making
an app-server request, then clears only the text after persistence succeeds.
Draft clearing creates and verifies a selection whose entire range is contained
by the composer editor; if that containment cannot be proven, it leaves the UI
untouched and reports that the saved draft needs manual clearing.
The save control owns an independent composer-remount observer, so switching
tasks cannot remove it when an older queue-manager injection is still active in
the same renderer during a hot upgrade.
It reads the composer's Markdown representation before falling back to rendered
plain text, preserving ordered-list markers that are not part of `innerText`.
Its pointer and click activation are isolated from native composer submission,
so saving a todo cannot also enqueue the draft.
Composer attachments remain in the composer and are not represented as saved.
Its panel lists app-server queued follow-ups first and locally held items second.
Queued items support `暂停`, `上移`, and `下移`; held items support `恢复`,
`上移`, `下移`, and `删除`. Every row also exposes `编辑`. Held rows edit
in place with explicit save/cancel controls. Editing an executable queued row
first completes the normal fail-closed pause transaction, then opens the held
copy for editing; it cannot remain executable while being edited.

`暂停` is fail-closed: the complete app-server input is persisted first. The
native item is deleted only after persistence succeeds. If deletion fails, the
new held copy is rolled back so the UI does not claim that the item was paused.
`恢复` adds the saved input back to the app-server queue before removing its
held copy.

If the native app reports that a queued follow-up no longer exists, the panel
opens with a stale-state warning and offers `同步原生队列`. Synchronization
preserves the current text draft locally across the explicit renderer reload.

## Data and ownership

App-server queued submissions remain authoritative for executable follow-ups.
Held records are stored in the native renderer's device-local storage, grouped
by thread id, with the full `input`, a stable local id, display summary, hold
timestamp, and bounded origin (`draft` or `paused-queue`). Legacy records with
no origin remain readable and are labeled without an inferred source. Storage
is bounded to 100 held records and invalid records are ignored when read.

The injected UI communicates only through the existing local native desktop
bridge and fixed `thread/queue/list`, `thread/queue/delete`,
`thread/queue/add`, and `thread/queue/reorder` methods. It does not accept a
remote host, path, or arbitrary method name.

## Acceptance criteria

- [x] The manager appears at the native composer for a selected local thread.
- [x] `存为待办` reappears after switching away from and back to a task, even
  while a legacy queue-manager lifecycle is still running in the renderer.
- [x] Rich-text ordered-list markers survive direct save, and activating the
  save control cannot propagate into the native executable queue path.
- [x] Every queued and held row has an edit action; queued editing pauses before
  the editor opens, and saving an edit never resumes execution implicitly.
- [x] A non-empty text draft can be saved directly as a held todo without
  entering the app-server queue; persistence happens before draft clearing,
  and clearing cannot select or delete content outside the composer.
- [x] Pausing removes a message from the executable queue only after its full
  input is durably held.
- [x] Held messages survive refresh/restart and never auto-send.
- [x] Resume explicitly appends the held input to the app-server queue.
- [x] Queued and held ordering controls persist in their respective stores.
- [x] A stale app-server queue error exposes a draft-preserving sync action.
- [x] Invalid records, failed bridge requests, and storage exhaustion fail
  without losing the executable message.

## Verification plan

- Unit: generated injection contains only the fixed queue methods, bounded
  storage, save-before-delete, add-before-remove, and stale recovery flow.
- Live native UI: verify the composer control renders and opens against the
  selected thread; verify an empty queue reports truthfully.
- Regression: `npm run check` and `npm test`.
