# Search sent messages

## Goal

Find a local Codex conversation from words the user previously sent, even when its project and title are unknown.

## Contract

- A separate button appears beside the existing project search in both enhanced and primary desktop sidebars. A fixed search action also appears in the enhanced desktop's top tab bar, before the recent-conversation menus. Both open the same dedicated search panel with its own query field and results; neither changes the active tab.
- Each panel opening starts with an empty focused query and no prior results. A bounded, device-local search history appears below the empty query; selecting an entry searches it again. Searches completed in the panel are added to history, newest first, without duplicates. The user can clear the history. History storage failure must not prevent searching.
- Native sidebar or tab bar remounts may detach either launcher. The existing periodic desktop injection reattaches missing launchers without replacing the panel, its query, or search history. Search does not observe unrelated changes across the whole page.
- Search covers non-archived, non-internal local conversations with readable native transcripts. It matches only user-authored message text, case and width insensitively.
- Results show the conversation title and a short excerpt around the latest matching user message. Selecting a result opens that conversation through the existing local navigation path.
- Search is requested on demand. The native renderer receives only bounded matching excerpts, never a full transcript or a persistent content index. Empty, loading, failed, and incomplete-history states are distinguishable.
- The desktop panel uses explicit layout and background styles because the native renderer does not provide the dashboard's utility classes. Search narrows native JSONL lines before parsing on supported hosts, with a read-only fallback when the prefilter is unavailable.
- A local SQLite FTS5 trigram projection indexes normalized user-authored messages in the private wrapper data directory. A background worker builds it without blocking the desktop bridge, incrementally adds appended transcript records, and removes sessions that are no longer eligible. Search shows partial-index progress until its first full pass completes. The native transcript remains authoritative; the index can be deleted and rebuilt.
- Remote devices and ChatGPT cloud history are outside this first local search scope. The UI states the local scope.

## Verification

- Test matching, filtering of internal/archived conversations, snippets, missing transcripts, and rendered result navigation.
- Test reopening with an empty query, selecting a history entry, and clearing history.
- Test that repeated injection restores both launchers after their containing UI is remounted.
- Test initial indexing, append reconciliation, archive removal, full-width matching, and partial-index status.
- Run repository checks and tests, then inspect the visible desktop search when the bridge is available.
