# Complete local project search conversations

Project search currently consumes the activity board's latest 160 session files.
Older conversations therefore disappear even when their project matches.

Read every page of unarchived `thread/list` metadata through the existing local
app-server client, including all source kinds. Use native names with preview and
unnamed fallbacks. Prefer an explicit project ID; use directory matching only
when no ID exists. Keep the activity board and project priority inputs bounded.
Do not read conversation bodies or mutate native sessions. Publish the search
catalog only after all pages succeed; retain the previous catalog as stale on
failure or repeated cursors. Continue using the existing refresh cache.

Remote results still use the bounded remote sidebar contract and must continue
to show their omitted-conversation count. Full remote retrieval is outside this
local data-source repair.

Verification: multiple thread pages beyond 160, project ownership, archive query,
duplicate cursor failure and stale snapshot retention; rendered search rows;
repository check and test suites.

## Validation evidence

- `npm run check`: passed, 345 syntax files and 371 structure files.
- `npm test`: 541 passed, zero failed.
- Local backend reloaded; live renderer reports search version 2026-09-09.1.
- Native metadata returned 254 unarchived threads. Existing `teye` search and
  expanded state were preserved; all four `teyes` conversations have rendered
  rows with layout, matching native metadata IDs. Three of those four are absent
  from the previous latest-160 adapter snapshot.
