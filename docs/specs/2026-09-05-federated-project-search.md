# Unified local and remote project search

Search the existing ordered local project catalog and normalized remote sidebar
snapshot in one input. No extra peer polling or filesystem access. Scope is the
projects/conversations already synchronized by those providers; cached offline
projects remain searchable. Results display 本机 or the remote device name and
离线 when appropriate. Keep local priority order followed by remote device/project
order. Match project names with the existing NFKC/case-insensitive substring rule.

Use a separate searchKey with device + project identity so equal IDs/names across
hosts never share expansion state or copy-path data. Preserve the source project ID
for copy-ID actions. Local/new-project IDs stay compatible with the native catalog.

Local conversation clicks retain native local routes. Remote conversation clicks
must use the existing remote-conversation bridge with exact device ID, thread ID,
project cwd and device name; never fall back to /local on a remote result. Offline
projects may expand and copy paths, but their conversation actions are disabled.
Right-click paths use the same combined catalog and remain tied to the owning
project. Retain the native row styling, query/focus, expansion, and copy-all-roots
behavior. Show the synchronized conversation limit when extra conversations exist.

Test duplicate IDs across hosts, offline retention, path identity, normalization,
UI labels/expansion, remote/local routing and disabled actions. Run repository
checks/tests; deploy the bounded changes to Mac and Windows and inspect runtime
provider counts and updated injection versions without sending user messages.
