# Native startup presentation

The fallback entry rail currently appears whenever no sidebar anchor exists,
including startup and the upstream error boundary. Remove this rail entirely;
wait for the real sidebar anchor before inserting the four native entries.
Existing native sidebar entries and console actions remain unchanged.

On macOS, stop the unconditional first-attachment Page.reload. CSP bypass is
still set/reasserted on the target before dashboard injection. A forced reload
while the upstream app is initializing can interrupt its load/fallback sequence;
the reported ERR_FAILED screenshot alone does not establish the original cause.
Windows keeps its existing compatibility reload behavior.

Verify no fallback DOM creation in generated script, native-entry behavior,
macOS no-reload configuration and current owner/embedded dashboard rendering.
Preserve unrelated working-tree changes and native running tasks. Do not claim
an upstream startup crash is fully resolved without a live cold-start replay.
