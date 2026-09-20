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

## 2026-09-20 correction

The current desktop runtime applies `frame-src` before a newly attached CDP
session can always make the loopback dashboard frame usable. A page marker from
an old session is not evidence that a new target-scoped bypass owns this
document. Platforms using the compatibility reload therefore reload at most once
per CDP connection/document. macOS still avoids an unconditional startup reload;
if the embedded-frame handshake fails after the native page is stable, its
bounded recovery request performs the reload under the active bypass.

Explicitly leaving a failed embedded workspace cancels its pending auto-recovery
so selecting a recent conversation cannot be covered again. Treat the live page
observer as the stable idempotency gate; native sidebar buttons and the titlebar
tab strip may disappear briefly during route transitions or particular layouts
and must not trigger teardown of a newly opened workspace or conversation.

Verify no fallback DOM creation in generated script, native-entry behavior,
macOS no-reload configuration and current owner/embedded dashboard rendering.
Preserve unrelated working-tree changes and native running tasks. Do not claim
an upstream startup crash is fully resolved without a live cold-start replay.
