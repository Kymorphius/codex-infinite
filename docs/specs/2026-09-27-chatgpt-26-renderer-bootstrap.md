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
  local iframe navigation. On macOS its native startup handshake is not reload
  safe: a CDP reload leaves the app on the launch logo because the main process
  does not resend the one-time bootstrap payload. macOS therefore does not enable
  the bypass or reload the document; it uses the standalone boundary below.
  Windows retains the prepared reload, and its new-document token prevents reload
  loops there.
- ChatGPT 26 also blocks loopback iframes and fetches in the already-running app
  document. macOS must not weaken that policy or attempt a late bypass. Its native
  entries call one allowlisted CDP binding which raises the signed standalone
  `加强版 ChatGPT` dashboard app. Windows retains the embedded dashboard.
- The standalone launch binding accepts only known dashboard module identifiers;
  it does not accept URLs, executable paths, arguments, or shell text. macOS does
  not install the hidden sidebar or terminal loopback frames in this mode.
- The isolated wrapper home atomically mirrors a source router catalog only when
  it parses and contains at least one model. An empty or malformed source never
  overwrites an existing valid wrapper catalog.
- The dedicated and primary native injectors share the same deferred-document
  wrapper. Feature modules keep their existing ownership and version guards.
- No login data, cookies, native project state, or session content is copied or
  rewritten.

## Verification

- Unit tests cover immediate and deferred execution and prove all document-start
  sources use the wrapper.
- Reload tests prove the injector waits for the new token rather than accepting the
  old document.
- A fresh macOS ChatGPT 26.924 launch reaches the native authenticated shell
  without a CDP reload; its control entry raises the standalone dashboard and no
  loopback iframe is added to the ChatGPT renderer.
