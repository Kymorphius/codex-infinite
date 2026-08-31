# Context and dispatch HTTP route extraction

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-29
- Related ADRs: none

## Problem

`src/http-server.mjs` still owns transport primitives, context-window workflows, dispatch targeting, dispatch persistence calls, and route composition. These are independent responsibilities, make the transport boundary difficult to review, and leave the service file at its ratcheted 318-line ceiling. Dispatch mutations also use a weaker origin check than the documented invariant and accept JSON bodies without requiring a JSON content type.

## Goals

- Extract shared HTTP response, bounded-body, content-type, origin, error, and path-decoding primitives.
- Give context-window routes and dispatch routes separate focused owners.
- Leave `src/http-server.mjs` responsible for server lifecycle and top-level route composition.
- Preserve public URLs, successful payloads, persistence behavior, and UI workflows.
- Require the exact dashboard origin for every context and dispatch mutation.
- Require `application/json` for dispatch `POST` and `PATCH` bodies.
- Ratchet the main HTTP service to its new lower size.

## Non-goals

- No UI redesign, persistence format, scheduler, dispatcher, context policy, or API URL changes.
- No frontend feature extraction in this slice.
- No Zotero route extraction; it will reuse the shared transport primitives and can move independently later.
- No remote-device protocol or network-listening changes.

## User experience

The task board and context controls continue to load, create, update, and delete data as before. Requests made outside the current control-console page receive a clear 403. Mutation requests without JSON content type receive 415 instead of being interpreted implicitly.

## Contracts and data

Existing `/api/context-overrides`, `/api/context-overrides/:threadId`, `/api/dispatches`, and `/api/dispatches/:id` payloads remain unchanged. Context `PUT`, dispatch `POST`, and dispatch `PATCH` accept bounded JSON. Context and dispatch mutations require `Origin` to exactly match `config.dashboardOrigin`. No persisted fields or migrations change.

## Design and ownership

- `src/http-utils.mjs` owns transport-level JSON responses, bounded JSON parsing, typed HTTP errors, exact-origin checks, JSON content-type checks, and safe path-segment decoding.
- `src/context-http.mjs` owns context route recognition and orchestration between the task adapter, context store, and model catalog.
- `src/dispatch-http.mjs` owns dispatch route recognition, target selection, and orchestration between the task adapter and dispatch store.
- `src/http-server.mjs` constructs the handlers, orders top-level routing, handles uncaught route errors, serves remaining APIs, and owns server lifecycle.

Route modules depend on transport primitives and application services; the shared transport module imports no route or application module.

## Security and privacy

All context and dispatch mutations fail closed without the exact loopback dashboard origin. Mutation bodies remain size-bounded. Malformed encoded identifiers return 400. No credentials or new data enter the browser, URLs, or logs. Listener binding remains loopback-only.

## Rollout and rollback

The change activates on local service restart and needs no data migration. Rollback restores the inline route blocks and earlier imports; stored dispatch and context data remain compatible.

## Acceptance criteria

- [x] Context list, set, and remove behavior remains compatible.
- [x] Dispatch list, create, update, and remove behavior remains compatible.
- [x] Missing or incorrect mutation origins return 403 without mutating stores.
- [x] Missing JSON content type returns 415 for body-bearing mutations.
- [x] Oversized or malformed JSON remains bounded and returns 413 or 400.
- [x] `src/http-server.mjs` only composes the extracted handlers and is below its previous 318-line ceiling.
- [x] Full tests, structure checks, and real task-board/context-page verification pass.

## Verification plan

- Unit: dispatch target selection and shared transport validation.
- Integration: context and dispatch success, service-unavailable, origin, content-type, malformed body, size, method, and missing-record cases.
- Real UI: reload the task board and context-status modules in the running integrated console and inspect browser errors.
- Structure and regression: run `npm run check`, `npm test`, and `git diff --check`.

## Shipped deviations

- Added `src/http-utils.mjs` (48 lines), `src/context-http.mjs` (45 lines), and `src/dispatch-http.mjs` (66 lines).
- Reduced `src/http-server.mjs` from 318 lines and 14,715 bytes to 177 lines and 9,006 bytes, then ratcheted its file-specific ceilings to those values.
- Tightened dispatch `POST`, `PATCH`, and `DELETE` to the same exact-origin policy already documented for all mutations. Dispatch body-bearing methods now require `application/json`.
- Malformed encoded route identifiers now return a typed 400 instead of falling through to a generic internal error.
- Added three dispatch HTTP integration tests and expanded context mutation coverage; the complete 58-test suite passes.
- Restarted the integrated service and verified the task board reaches its connected state with all 16 projects. The context page rendered one saved million-token override with the expected 872,000 accepted and 828,400 effective values; browser logs contained no warnings or errors.
