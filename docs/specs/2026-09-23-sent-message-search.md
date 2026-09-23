# Search sent messages

## Goal

Find a local Codex conversation from words the user previously sent, even when its project and title are unknown.

## Contract

- A separate button appears beside the existing project search in both enhanced and primary desktop sidebars. It opens a dedicated search panel with its own query field and results.
- Search covers non-archived, non-internal local conversations with readable native transcripts. It matches only user-authored message text, case and width insensitively.
- Results show the conversation title and a short excerpt around the latest matching user message. Selecting a result opens that conversation through the existing local navigation path.
- Search is requested on demand. The native renderer receives only bounded matching excerpts, never a full transcript or a persistent content index. Empty, loading, failed, and incomplete-history states are distinguishable.
- The desktop panel uses explicit layout and background styles because the native renderer does not provide the dashboard's utility classes. Search narrows native JSONL lines before parsing on supported hosts, with a read-only fallback when the prefilter is unavailable.
- A local SQLite FTS5 trigram projection indexes normalized user-authored messages in the private wrapper data directory. A background worker builds it without blocking the desktop bridge, incrementally adds appended transcript records, and removes sessions that are no longer eligible. Search shows partial-index progress until its first full pass completes. The native transcript remains authoritative; the index can be deleted and rebuilt.
- Remote devices and ChatGPT cloud history are outside this first local search scope. The UI states the local scope.

## Verification

- Test matching, filtering of internal/archived conversations, snippets, missing transcripts, and rendered result navigation.
- Test initial indexing, append reconciliation, archive removal, full-width matching, and partial-index status.
- Run repository checks and tests, then inspect the visible desktop search when the bridge is available.
