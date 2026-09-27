# Current ChatGPT integration

The dedicated macOS ChatGPT profile targets the current host only. Do not restore
legacy iframe-based restart controls or seed its model list from an old merged
catalog. Existing sessions, credentials and routing transport remain unchanged.

- Mount one restart item in the current Help menu, including its Chinese label.
- Confirm locally, then use the existing allowlisted host binding. No network
  request, iframe, CSP exception or permanent toolbar button is required.
- Install the restart integration even when the dashboard runs separately.
- For an existing router-managed dedicated profile, explicitly designate its
  native account model cache as the router's native catalog source. Do not turn
  on provider discovery or overwrite an explicitly configured different source.
- Rebuild the router catalog through its own publisher, preserving external
  routes. A missing/invalid native cache must not publish a fabricated model list.
- Verify menu lifecycle, confirmation rejection, binding validation, native
  catalog source persistence and the full check/test suite. Runtime health is
  not a substitute for visual acceptance when desktop access is unavailable.
