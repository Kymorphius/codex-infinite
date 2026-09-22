# Return an assigned to-do to the claimable inbox

The composer row for a claimed or assigned general task replaces `管理` with
`退回`. Returning clears `assignedThreadId` on the same unfinished task and
preserves its ID and text. The task reappears in the task-claim list and leaves
the current conversation's to-do panel. No native queue operation is involved.
Composer-saved messages keep their existing controls.

The clicked row captures its conversation and task identity. Both the composer
handler and checklist bridge validate the current conversation; the bridge also
checks ID, text, unfinished status and assignment against the general inbox,
independently of which project dialog was last opened. Stale clicks fail closed.

Use the existing durable pending actions and acknowledgment path. While awaiting
confirmation, disable the composer actions and retain the assigned row; do not
optimistically remove it, so an older disk snapshot cannot resurrect it. The
existing synchronization publishes the persisted assignment and claimable count.
Pending returns survive retry/reload. Storage failure or a missing bridge keeps
the task visible and shows an actionable warning. No new polling or DOM observer.

Verify return/persistence/reclaim with the same ID and text, pending/error paths,
navigation and stale-task guards, isolation from unrelated projects, and that no
send API runs. Run the required project checks and inspect the live rendered
buttons; use a temporary test task for an end-to-end return/reclaim check.
