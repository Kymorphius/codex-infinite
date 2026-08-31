# Task and Zotero HTTP route extraction

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-29
- Related ADRs: none

## Problem

After context and dispatch extraction, `src/http-server.mjs` still owns task reads and the complete Zotero HTTP workflow. It therefore retains adapter calls, query mapping, offline payloads, write result mapping, body limits, and feature-specific errors. Task endpoints also accept unsupported methods as successful reads, and invalid Zotero authorization fields can fall through to a generic 500 because their intended typed error is not in scope.

## Goals

- Give task reads and Zotero routes separate focused HTTP modules.
- Leave `src/http-server.mjs` as server lifecycle, health response, route composition, error boundary, and static fallback only.
- Preserve all successful task and Zotero URLs, payloads, query mapping, offline states, write status mapping, body limits, and exact-origin protections.
- Restrict read-only task routes to `GET` and `HEAD`.
- Return typed 400 responses for malformed task/Zotero identifiers and invalid authorization-control fields.
- Ratchet the main server to its final lower structure ceiling.

## Non-goals

- No task adapter, Zotero database adapter, Zotero Local API protocol, persistence, credential, UI, or network-listening changes.
- No new Zotero operation or task mutation.
- No frontend modularization in this slice.

## User experience

Task, session, dispatch, priority, context, and literature views load as before. Unsupported methods on task reads return 405. Malformed identifiers and invalid authorization-control bodies return clear 400 responses instead of internal errors. Zotero offline and authorization states remain truthful.

## Contracts and data

The existing `/api/tasks`, `/api/tasks/:id`, and `/api/zotero/*` paths and successful bodies remain unchanged. Zotero write body ceilings remain 8 KiB for authorization controls, 32 KiB for collections, and 256 KiB for item/edit/note bodies. Zotero mutations continue requiring the exact dashboard origin and JSON content type. No persisted data changes.

## Design and ownership

- `src/tasks-http.mjs` recognizes task collection/item routes, enforces read methods, decodes identifiers, and delegates to the read-only task adapter.
- `src/zotero-http.mjs` recognizes all Zotero routes and owns query mapping, offline responses, mutation method policy, body bounds, and Local API result mapping.
- `src/http-server.mjs` creates all bounded-context handlers and calls them in explicit order before the static fallback.
- `src/http-utils.mjs` remains the dependency-free shared transport layer.

## Security and privacy

Task access remains read-only. Zotero mutations remain exact-origin protected and body bounded. Credentials remain inside the Local API adapter and never enter browser payloads or logs. Invalid percent encoding fails with 400. Both listeners remain loopback-only.

## Rollout and rollback

The extraction activates on service restart and requires no migration. Rollback restores inline task and Zotero route blocks; all stored state remains compatible.

## Acceptance criteria

- [x] Task collection and item reads remain compatible, including not-found behavior.
- [x] Unsupported task methods return 405 and malformed identifiers return 400.
- [x] Zotero status, collections, items, edit, authorization, creation, note, and offline contracts remain compatible.
- [x] Zotero query parameters and HTTP status mapping remain unchanged.
- [x] Zotero mutation origin, content-type, and size boundaries remain enforced.
- [x] Invalid authorization-control fields and malformed identifiers return 400.
- [x] `src/http-server.mjs` contains no task- or Zotero-specific workflow.
- [x] Full tests, structure checks, and real task/literature UI verification pass.

## Verification plan

- Unit: route target decoding and method policy through focused HTTP integration tests.
- Integration: task list/item/missing/method/malformed cases; Zotero reads, query mapping, writes, offline state, origin, content type, limits, invalid controls, malformed keys, and unknown routes.
- Real UI: reload sessions/board and literature modules in the integrated control console; inspect connected/offline states and browser logs.
- Structure and regression: run `npm run check`, `npm test`, and `git diff --check`.

## Shipped deviations

- Added `src/tasks-http.mjs` (24 lines) and `src/zotero-http.mjs` (110 lines).
- Reduced `src/http-server.mjs` from 177 lines and 9,006 bytes to 66 lines and 3,261 bytes, then ratcheted its file-specific ceilings to those values.
- Restricted `/api/tasks` and `/api/tasks/:id` to `GET` and `HEAD`; unsupported methods now return 405 without invoking the adapter.
- Task and Zotero identifiers now use the shared safe decoder and return 400 for malformed percent encoding.
- Restored the intended 400 response for non-empty authorization-control bodies instead of a generic 500 caused by a missing inline error dependency.
- Added six focused task/Zotero HTTP tests; the complete 64-test suite and structure checks pass.
- Restarted the integrated service. Real UI verification observed 1 device, 18 directories, and 160 sessions; the literature view rendered 2,337 items and 535 collections while truthfully reporting that Zotero write-back was not running. Browser logs contained no warnings or errors.
