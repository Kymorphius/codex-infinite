# Annotation editor follows the reading turn

While scrolling the native conversation timeline, select the stable turn whose
visible block intersects the upper third of the scroll viewport; in a gap use
the nearest visible turn. If anchors are virtualized, fall back to the native
current message marker. Ignore scroll events in the annotation editor, sidebars,
code blocks and either navigation rail. Coalesce timeline scroll events by frame; resample during the first 900ms after
scrolling to catch native virtualized-layout settling. New scroll events supersede
older callbacks, and manual selection cancels pending follow callbacks.

Update the editor's turn selector and text together, only when the reading turn
changes. Preserve every input under its original thread/turn identity in the
existing persistent pending draft queue; saving old drafts must not overwrite
the newly displayed note. Defer following until IME composition completes. Do not
change the editor selection on unrelated polling, note acknowledgements or native
stream updates. Manual selection remains until the next conversation scroll.
Initialize the editor to the current reading turn when a conversation opens.
Tests cover visible geometry/gaps, unchanged caret on same-turn scroll, exact
scroll scoping, draft preservation, IME deferral and disposal. Check and full tests,
then deploy to Mac and Windows and verify actual timeline scrolling switches the
editor. Keep card placement and both rails intact.

At the bottom boundary, always select the latest stable turn, even when that
turn is short and lies below the reading line or its anchor is virtualized.
Native column-reverse scroll containers end at scrollTop approximately zero;
ordinary containers end at scrollHeight minus clientHeight. Allow a 2px rounding
tolerance. Outside the bottom boundary, retain reading-position selection.
