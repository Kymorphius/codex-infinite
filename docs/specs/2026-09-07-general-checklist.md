# 综合任务清单

Add an independent sidebar entry 综合任务清单 at the top of the sidebar sections. It opens the existing checklist dialog with a reserved global inbox key, without requiring a project or assignee. The dialog explains that this list collects tasks whose ownership is undecided. Add, edit, complete and delete reuse the durable checklist store and pending-action recovery. Project lists remain isolated. Storage stays local to each device; this change does not introduce assignment, execution or synchronization.

The console owns the added sidebar root. Native React rows are neither moved nor modified. Repeated installation and native sidebar remounts keep one entry. The reserved key `ccc:general-inbox:v1` cannot collide with native project UUIDs or remote catalog keys.

Verify scope isolation, dialog labels, add/save acknowledgements and sidebar remount/disposal. Run npm run check and npm test, then inspect both deployed native interfaces.
