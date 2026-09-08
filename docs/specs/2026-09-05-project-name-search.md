# Sidebar project name search

Place an owned search input above automatic sidebar sections (order 4). Case-
insensitive NFKC substring matching by project name, preserving priority order.
Results are additive project aliases, including projects in collapsed categories
and empty projects. Empty query shows no results; clearing/Escape restores the
normal view without moving/hiding React-owned rows or changing native settings.
Results expand to their indexed local conversations, navigating existing native
/local/UUID routes. Explicitly label the indexed conversation scope. No drag/drop.
Opening a search-result conversation only navigates to that conversation and must
not expand, scroll, or otherwise navigate the native Projects section. A local
search-result project's context menu provides the explicit “在项目中打开” action;
that action centers and expands the native project and opens its indexed first
conversation. Remote projects explain that locating must happen on their owning
device. Preserve the search query throughout.

Reuse the new-project service's complete ordered project catalog and task snapshot
without extra polling/processes. Publish a separate safe search snapshot containing
only IDs, names and task titles; stale snapshots retain data with an unavailable
hint. Search UI owns its DOM, preserves input focus on snapshot updates, and avoids
observer loops. Clear on window restart; no search-text persistence.

Check matching, duplicates, empty projects, original order, safe display contract,
script syntax and injector integration. Run check/tests and deploy both consoles;
read back search input and full catalog without altering user conversations.

## Native result-row presentation

Search results use the current native project-row classes, native section horizontal
padding, leading folder-icon slot and label typography. Folder icons follow the
result's own expanded state. Remove textual chevrons and the redundant recent-chat
heading; expanded task rows use native row height, hover/focus treatment, title
classes and nested indentation. Copy SVG presentation through an allowlist only;
never clone native IDs, drag/drop state, React nodes, event handlers or selection.
Recompute the presentation when native templates change, without replacing the
search input or losing query/focus. Keep project search IDs for copy-path routing.
Validate render behavior, native class/icon adoption, expansion and copy-selector
preservation with DOM tests, then run required checks and deploy both desktops.
