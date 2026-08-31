# 0005: Scope Chromium LNA and CSP compatibility to the dedicated wrapper

- Status: accepted
- Date: 2026-08-30
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-08-30-chromium-lna-local-dashboard.md`

## Context

Chromium 151 blocks the product's `app://-` to `127.0.0.1` dashboard iframe
with Local Network Access policy `PermissionBlock`. The response succeeds, but
the renderer substitutes an error document. Once the LNA gate is removed, the
installed renderer's explicit `frame-src` policy independently rejects the same
navigation with `ERR_BLOCKED_BY_CSP`. The opaque application origin has no
supported web path to request LNA permission, while the embedded workspace is a
core product surface.

## Decision

Launch only the dedicated wrapper process with
`--disable-features=LocalNetworkAccessChecks`. Retain the dedicated profile,
fixed loopback dashboard/CDP origins, exact-origin mutation validation, bounded
contracts, and credential isolation. Version the wrapper process signature so
an instance without this compatibility mode is never reused.

Enable `Page.setBypassCSP` only on the selected dedicated Codex main-page target.
Register the injection and compatibility marker as new-document scripts, then
perform one native reload when the marker is absent because Chromium does not
apply the bypass reliably to iframe navigation in an already-created document.
The marker prevents a service-only restart from reloading the user interface.
Never modify the application archive or replace the live React document.

## Alternatives considered

- **Ask for LNA permission:** the injected opaque `app://-` origin cannot invoke
  a usable permission flow in the current desktop host.
- **Open a separate browser window:** restores access but abandons the integrated
  native workspace the product is designed to provide.
- **Use `srcdoc` or data URLs:** static rendering alone would work, but dashboard
  assets and APIs would still cross into loopback and be gated; relaying the
  entire application over CDP would duplicate the HTTP boundary and greatly
  increase complexity.
- **Disable web security for the process:** materially broader than the selected
  target-scoped CDP bypass and would affect every renderer.
- **Patch the CSP meta element or replace the document in memory:** changing an
  already parsed meta policy does not relax the active policy; replacing the
  live document prevents the native module bootstrap from reinitializing
  correctly in the existing JavaScript realm.
- **Modify `app.asar`:** brittle across signed application upgrades and changes
  the installed vendor application on disk.
- **Expose the dashboard on a non-loopback address:** violates a core safety
  invariant and does not reliably avoid address-space classification.

## Consequences

The embedded dashboard works on the current runtime. LNA checks are disabled
for every renderer in the dedicated wrapper process, which is a broader browser
capability than the one dashboard iframe. CSP enforcement is bypassed for the
dedicated main-page target, which is broader than adding one `frame-src` origin
but narrower than disabling web security for the process. The exposure is
contained to an isolated profile and compensated by loopback-only listeners,
fixed injected URLs, and exact-origin mutations; normal Codex and external
browsers remain unchanged. Future desktop versions should be re-evaluated for a
host-supported permission grant so both compatibility relaxations can be
removed.

## Supersedes / superseded by

None.
