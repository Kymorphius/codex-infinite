# Zotero read adapter modularization

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: none

## Problem

`src/zotero-adapter.mjs` is 547 lines and combines SQLite connection lifecycle, schema capability detection, SQL construction, row normalization, collection ordering, and related-metadata hydration. It is frozen structural debt and makes query changes affect the read-only safety boundary.

## Goals

- Keep `ZoteroAdapter` as the read-only connection and use-case coordinator.
- Extract pure response/row normalization and collection ordering.
- Keep schema-dependent SQL construction close to the adapter while separating reusable normalization and hydration.
- Extract batched creator, tag, collection, note, and attachment hydration.
- Preserve every API response and database query result.

## Design

- `src/zotero-read-contract.mjs` owns constants, bounded input normalization, safe public error messages, collection ordering, count mapping, and item-row mapping.
- `src/zotero-read-metadata.mjs` owns batched related-row queries and mutates only the normalized item objects passed to it.
- `src/zotero-adapter.mjs` retains database opening, `PRAGMA query_only`, schema checks, response orchestration, logging, and close/discard behavior.

Dependencies point from the adapter to the two focused modules. Neither extracted module imports SQLite, filesystem, HTTP, or credentials. During implementation, schema-dependent SQL fragments remained in the adapter: extracting them required a callback-heavy capability object while providing no independent reuse, whereas row contracts and metadata hydration formed stable seams.

## Safety invariants

- SQLite still opens with `readOnly: true` and verifies `PRAGMA query_only = 1`.
- No write statement or attachment-content access is introduced.
- Public errors never expose database paths or raw SQLite messages.
- Search length, pagination bounds, escaped LIKE terms, and fixed parameter order remain unchanged.

## Verification

- Add pure tests for bounds, escaping, collection ordering, row mapping, and query parameter order.
- Retain the real SQLite fixture test proving query-only enforcement and identical status/collection/item responses.
- Run all Zotero HTTP and Local API safety suites plus the full project suite.
- Verify the real UI still reports the same collection/item counts and search behavior.

## Acceptance criteria

- [x] Every new module and `src/zotero-adapter.mjs` is within the default structure budget.
- [x] Existing normalized response contracts remain unchanged.
- [x] The read-only and public-error invariants retain dedicated test evidence.
- [x] `src/zotero-adapter.mjs` is removed from frozen structural debt.
- [x] Full structure and regression checks pass.

## Shipped evidence

- `src/zotero-adapter.mjs` decreased from 547 lines to 317 lines; contract mapping is 87 lines and metadata hydration is 107 lines.
- The real SQLite fixture still proves `readOnly: true`, verified `PRAGMA query_only`, identical hierarchy, search, metadata, and response payloads.
- Dedicated pure tests cover input bounds, LIKE escaping, hierarchy, item defaults, and path-safe public errors.
- The full suite passes 81 tests. A fresh real server still reports 2,337 items, 535 collections, and 24 first-page cards with no browser warnings or errors.
