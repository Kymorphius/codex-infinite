# Sidebar restart shortcut

Add a compact 重启 button beside the native bottom-left Help menu in our dedicated
window. Keep the panel button. Own the shortcut outside React DOM; position from
Help's bounding rectangle and hide if Help is absent. Do not alter native children.

Click opens a small confirmation surface from the exact dashboard origin, without
navigating the current conversation or opening the full panel. Its visible 重启
button reuses the existing restart client and exact-origin endpoint; opening the
shortcut alone must never restart. Cancel disposes only the confirmation frame.
Accept close messages only from this frame and dashboard origin. Preserve active
conversation and drafts on cancellation; support resize and UI replacement.

Verify placement using live rectangles; validate script, no automatic restart,
message source/origin checks, and static routes. Run check/tests, deploy both own
windows, and inspect button presence without triggering restart.
