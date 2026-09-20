# 综合任务清单

Add an independent sidebar entry 综合任务清单 at the top of the sidebar sections. It opens the existing checklist dialog with a reserved global inbox key, without requiring a project or assignee. The dialog explains that this list collects tasks whose ownership is undecided. Add, edit, complete and delete reuse the durable checklist store and pending-action recovery. Project lists remain isolated. Storage stays local to each device; this change does not introduce assignment, execution or synchronization.

The same dialog also projects every native composer held todo from the local held-message store. These are not copied into the generic checklist: their original conversation, complete send input, ordering, and explicit-resume safety contract remain authoritative in the held-message store. A held row shows its origin and offers `打开会话`; it does not offer completion or automatic sending. When a composer held todo changes while the dialog is open, it refreshes the projection immediately.

Regular inbox tasks may be assigned to one local conversation. Every local composer also exposes `领取任务`, which filters the same inbox to unfinished, unassigned tasks and assigns the selected task to that conversation. Assignment and claim never enqueue a message or start a turn. A new-chat composer keeps the button visible with the current claimable count; clicking it opens the general inbox for inspection, and the first turn can then claim into the newly created conversation.

The console owns the added sidebar root. Native React rows are neither moved nor modified. Repeated installation and native sidebar remounts keep one entry. The reserved key `ccc:general-inbox:v1` cannot collide with native project UUIDs or remote catalog keys.

Verify scope isolation, dialog labels, add/save acknowledgements and sidebar remount/disposal. Run npm run check and npm test, then inspect both deployed native interfaces.
