# ChatGPT 26 renderer bootstrap compatibility

## Problem

ChatGPT 26.924 creates the `app://-` renderer earlier in its login bootstrap.
CDP's new-document hooks now run before `documentElement` and `body` exist. The
console registered DOM-dependent injection scripts directly at document start, so
the new renderer produced null-root observer/append errors and left features only
partially installed. A reload could also be mistaken for complete while CDP was
still observing the previous document.

## Contract

- New-document hooks remain registered before navigation so no renderer is missed.
- DOM-dependent sources execute immediately only when both `documentElement` and
  `body` exist; otherwise they execute once at `DOMContentLoaded`.
- Direct installation after a compatibility reload waits for a new document token,
  a usable DOM, and `interactive` or `complete` readiness.
- The dashboard shell and its loopback iframes install only after the live CDP
  connection reapplies the target-scoped CSP bypass; document-start hooks never
  create loopback frames.
- ChatGPT 26 requires the target-scoped CSP bypass to be active before its first
  local iframe navigation. macOS therefore uses the same one-time prepared reload
  as Windows; the new-document token prevents reload loops.
- The dedicated and primary native injectors share the same deferred-document
  wrapper. Feature modules keep their existing ownership and version guards.
- No login data, cookies, native project state, or session content is copied or
  rewritten.

## Verification

- Unit tests cover immediate and deferred execution and prove all document-start
  sources use the wrapper.
- Reload tests prove the injector waits for the new token rather than accepting the
  old document.
- A real ChatGPT 26.924 reload produces no null-root bootstrap exceptions from the
  console injections.
