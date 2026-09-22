# 综合任务清单

Add an independent sidebar entry 任务清单 in the persistent top action group,
immediately after 新对话 and 打开本地项目. It inherits the native new-chat
button classes and remains visible while the section list scrolls; it is not a
sticky child of the Projects list. The entry opens the existing 综合任务清单
dialog with a reserved global inbox key, without requiring a project or assignee.
The dialog explains that this list collects tasks whose ownership is undecided.
Add, edit, complete and delete reuse the durable checklist store and pending-action
recovery. Project lists remain isolated. Storage stays local to each device; this
change does not introduce assignment, execution or synchronization.

The same dialog also projects every native composer held todo from the local held-message store. These are not copied into the generic checklist: their original conversation, complete send input, ordering, and explicit-resume safety contract remain authoritative in the held-message store. The checklist itself opens before this cross-conversation projection is read; that potentially large local read is scheduled for idle time and cached for the open dialog, so it cannot delay task entry or editing. A held row shows its origin and offers `打开会话`; it does not offer completion or automatic sending. When a composer held todo changes while the dialog is open, it refreshes the projection in the next idle slice.

Regular inbox tasks may be assigned to one local conversation. Task and todo are one entity at different states, not parallel records: `未指派任务 → 已指派待办（暂停）→ 排队 → 发送`. The main general list contains only unassigned records; immediately after assignment or claim, the same record leaves that list and appears in the lower conversation-todo projection, where reassignment is available. Every local composer also exposes `领取任务`, which filters the same inbox to unfinished, unassigned tasks and assigns the selected task to that conversation. The receiving conversation projects unfinished assigned records into its `待办` panel using the same `待办·暂停` label, count, and `恢复` action as other paused todos; it never exposes a separate task category. `恢复` explicitly adds its text to the native send queue and then marks the source record complete, preventing a duplicate restore. `管理` opens the authoritative checklist for editing, reassignment, or deletion. Claim never enqueues a message or starts a turn. A new-chat composer keeps the button visible with the current claimable count; clicking it opens the general inbox for inspection, and the first turn can then claim into the newly created conversation.

The console owns the added sidebar root. Native React rows are neither moved nor modified. Repeated installation and native sidebar remounts keep one entry. The general snapshot is proactively published only when it changes, so opening the dialog does not wait for the 1.2-second injector poll. Assignment uses an in-dialog native conversation selector with explicit confirm/cancel controls; it never depends on browser `prompt`. The reserved key `ccc:general-inbox:v1` cannot collide with native project UUIDs or remote catalog keys.

The conversation to-do panel is a live, version-guarded injection rather than a document-start script. It must not accumulate historical renderers across service reconnects. A claimed or assigned general task is presented as the same paused to-do entity as a composer-saved item, with one combined to-do count and no legacy task-only row or count.

Verify scope isolation, dialog labels, add/save acknowledgements and sidebar remount/disposal. Run npm run check and npm test, then inspect both deployed native interfaces.
