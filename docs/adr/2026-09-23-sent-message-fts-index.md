# Local FTS index for sent message search

## Decision

Maintain a rebuildable SQLite FTS5 trigram index of normalized user-authored message text in the node's private wrapper data directory. Build and refresh it in a worker thread. Read native session JSONL as the only authority; do not write to native Codex storage. Query the local index for message substrings and send only bounded result excerpts to the renderer.

## Why

Searching every historical JSONL file on each keystroke took about six seconds for a common term on a 15 GB local history, even after line prefiltering. The bundled Node runtime already includes SQLite and FTS5 trigram support. This avoids adding a native package that would need separate macOS and Windows builds. A persistent projection pays the full scan once and keeps later searches independent of total transcript size.

## Boundaries

The index contains a local copy of sent message text. Keep it under the existing private wrapper directory, set the database file to owner-only permissions, and remove archived or internal sessions from it. Exclude it from source control. Initial and failed indexing must be visible as incomplete search, not a false empty result. If SQLite indexing is unavailable, retain the read-only transcript search fallback.
