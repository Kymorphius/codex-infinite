# 0028: ChatGPT 26 macOS standalone dashboard boundary

- Status: accepted
- Date: 2026-09-27
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-09-27-chatgpt-26-renderer-bootstrap.md`

## Context

ChatGPT 26.924 on macOS has a one-time native bootstrap handshake. Reloading its
renderer through CDP leaves the product on its launch logo. Without a reload, the
document's CSP rejects loopback iframes and fetches, including the embedded control
console and its hidden terminal/sidebar bridges. A late `Page.setBypassCSP` does not
make those navigations usable.

## Decision

The macOS dedicated renderer is never reloaded for control-console preparation and
does not receive loopback frames. Native entries invoke an allowlisted Runtime
binding that can only raise the installed `加强版 ChatGPT` application. The process
adapter owns `/usr/bin/open` and the fixed bundle identifier. Windows keeps the
existing prepared-reload and embedded-dashboard behavior.

The isolated wrapper CODEX_HOME continues to own its configuration, but receives
an atomic mirror of the source router catalog only when that catalog is valid and
non-empty and the wrapper has no valid catalog. After the router refreshes a
catalog for the dedicated profile, that catalog remains authoritative. This
supplies the native App Server with its configured model catalog without sharing
writable configuration ownership.

## Alternatives considered

- Reload the macOS renderer after enabling CSP bypass: rejected because the native
  main process does not replay its startup payload.
- Disable or rewrite the product CSP: rejected because it weakens a host security
  boundary and would be coupled to undocumented renderer internals.
- Remove the control entries: rejected because the standalone dashboard remains a
  supported local surface and can be raised without broad renderer privileges.

## Consequences

The ChatGPT shell starts normally and preserves its CSP. Control-console modules on
macOS open in the standalone app rather than inside the native content area. The
binding deliberately carries only an allowlisted module name; the current launcher
raises the dashboard's default console view, where the user can select other
modules. Native hidden-frame features are unavailable in the ChatGPT renderer on
this version and remain available in the standalone dashboard.

## Supersedes / superseded by

None.
