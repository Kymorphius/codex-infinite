# Web UI modularization

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-29
- Related ADRs: none

## Problem

`public/app.js` has reached 1272 lines and owns application state, module navigation, formatting, sessions, dispatch, context controls, priority, Zotero UI, network calls, and event registration. A small UI change can affect unrelated features, focused tests are difficult, and the file can no longer grow under the structural budget.

## Goals

- Turn `public/app.js` into a small bootstrap and composition module.
- Give sessions, dispatch, context, priority, and Zotero separate UI ownership.
- Keep shared state, transport, DOM helpers, notifications, and module navigation in focused core modules.
- Preserve the current build-free local startup and embedded Codex behavior.
- Preserve all visible behavior and safety boundaries during extraction.

## Non-goals

- No visual redesign as part of the extraction.
- No frontend framework or build tool adoption.
- No API, persistence, authentication, or native-route changes.
- No simultaneous backend refactor.

## User experience

The change is behavior-preserving. Entry points, loading/empty/error states, filters, native conversation opening, and navigation remain unchanged. Any visual difference is a regression unless separately specified.

## Contracts and data

Existing `/api/*` responses and parent-frame messages remain unchanged. Feature modules receive normalized state and explicit dependencies rather than reading unrelated global state.

## Design and ownership

Target structure:

```text
public/
  app.js
  core/dom.js
  core/format.js
  core/navigation.js
  core/state.js
  core/tasks.js
  core/transport.js
  features/sessions/index.js
  features/dispatch/index.js
  features/context/index.js
  features/priority/index.js
  features/zotero/index.js
  features/zotero/browser.js
  features/zotero/editor.js
  features/zotero/format.js
```

Extraction order:

1. Sessions — recently changed, bounded, and already has a clear render/filter/event surface.
2. Priority and console — read-only consumers of the same normalized task state.
3. Dispatch and context — mutation-capable application features.
4. Zotero — largest feature and most security-sensitive UI boundary.
5. Shared formatting, transport, navigation, and final bootstrap cleanup.

Feature modules may import `core/*`; feature-to-feature imports are not allowed. The bootstrap creates shared services, loads data, and passes explicit dependencies to features.

For the final extraction slice, `core/state.js` owns the initial normalized browser state and module catalog; `core/dom.js` owns notifications and scoped state rendering; `core/format.js` owns shared task/date formatting; `core/tasks.js` owns `/api/tasks` loading and normalization; and `core/navigation.js` owns module chrome plus the parent-frame task-open message contract. These modules expose callbacks rather than importing feature modules, so `public/app.js` remains the only composition point.

## Security and privacy

No trust boundary changes. The browser continues to receive no credentials. Mutation requests continue to rely on exact-origin server checks. Session data remains read-only and native conversation opening continues through the parent-frame message contract.

## Rollout and rollback

Extract one feature per change while retaining existing behavior tests and real embedded UI inspection. Each extraction is independently reversible because contracts and markup remain stable.

## Acceptance criteria

- [x] `public/app.js` is at most 250 lines and only composes modules.
- [x] Every extracted feature module is within the default structure budget.
- [x] No extracted feature imports another feature.
- [x] Existing tests continue to pass throughout extraction.
- [x] Sessions search, status filter, grouping, and native open flow pass real-UI verification.
- [x] Dispatch and Zotero mutation behavior retains origin and credential protections.
- [x] `npm run check` reports no growth in frozen structural debt.

## Verification plan

- Unit: extract pure filtering, grouping, formatting, and payload helpers with feature-focused tests.
- Integration: retain HTTP and adapter suites; add browser-module contract tests where practical.
- Real UI: inspect every module in the embedded Codex workspace after its extraction.
- Structure and regression: run `npm run check` and `npm test` after each slice.

## Shipped deviations

### Slice 1: sessions

- Added `public/features/sessions/index.js` as a 163-line feature module.
- Moved session filtering, directory/device grouping, rendering, and event binding out of `public/app.js`.
- Added pure tests for grouping, metadata search, status filtering, and interrupted/error normalization.
- Changed the browser entry to a native ES module and explicitly served the feature module from the loopback HTTP server.
- Reduced `public/app.js` from 1272 to 1108 lines and ratcheted the structure budget to the new lower baseline.
- Real embedded verification observed 18 projects and 160 sessions; searching `mulitca` returned one project and six sessions; native open and return both succeeded.

### Slice 2: console and priority

- Added `public/features/console/index.js` as a 54-line feature module.
- Added `public/features/priority/index.js` as a 74-line feature module.
- Moved loading/empty/error state ownership, metrics, list rendering, and native-open controls out of `public/app.js`.
- Added focused metric tests for truthful connected and unavailable states.
- Reduced `public/app.js` from 1108 to 1041 lines and ratcheted the structure budget again.
- Real embedded verification observed 160 console task cards with native-open actions and 16 priority projects in descending score order with working scrolling.

### Slice 3: dispatch and context

- Added `public/core/transport.js` as an 11-line shared JSON request boundary.
- Added `public/features/dispatch/index.js` as a 175-line feature module owning project/thread selection, six-column rendering, metrics, create/move/delete actions, loading states, and polling refreshes.
- Added `public/features/context/index.js` as a 133-line feature module owning task options, saved-override rendering, metrics, load/save/remove actions, and lazy initialization.
- Added pure tests for dispatch column normalization, dispatch metrics, destination normalization, and context availability metrics.
- Registered the new feature and core modules in the explicit static-asset allowlist.
- Reduced `public/app.js` from 1041 lines and 50,931 bytes to 824 lines and 38,748 bytes and ratcheted the structure budget again.
- Real embedded verification observed 16 project destinations; selecting `mulitca` populated six native conversation choices. The context page rendered one saved million-token override with 872,000 accepted and 828,400 effective values. Browser logs contained no warnings or errors.

### Slice 4: Zotero

- Added a 116-line Zotero composition module, a 170-line read-only browser, a 301-line authorization/editor boundary, and a 66-line pure formatting module.
- Kept read routes independent from write authorization. Editor mutations still require explicit authorization, a complete confirmation summary, version checks, and the server's exact-origin protection.
- Added pure tests for creator parsing, line and tag normalization, and write-state labels; retained the existing mutation, credential, conflict, and Local API suites.
- Registered every imported Zotero module in the exact static-asset allowlist.
- Reduced `public/app.js` from 824 lines and 38,748 bytes to 164 lines and 8,696 bytes, removing it from frozen structural debt.
- Real embedded verification observed 2,337 items and 535 collections with 24 cards on the first page. Searching `创造之门` returned two matching items and clearing restored the page. With Zotero Local API offline, write controls stayed disabled and the browser log remained empty.

### Slice 5: shared core and composition root

- Added focused core modules for initial browser state, DOM notifications and scoped states, shared task formatting, normalized task loading, and module/native-frame navigation.
- Kept the feature dependency rule intact: core services accept callbacks and never import feature modules; `public/app.js` is the only browser composition point.
- Added focused tests for isolated initial state, task response normalization and notification order, shared labels and units, plus the minimal fail-closed native task-open message contract.
- Registered every core module in the exact static-asset allowlist.
- Reduced `public/app.js` from 164 lines and 8,696 bytes to 69 lines and 3,214 bytes.
- Completed real embedded verification after a fresh server start: sessions showed one device, 19 directories, and 160 conversations; refresh preserved the data; Zotero showed 2,337 items, 535 collections, and 24 first-page cards; context lazy loading showed one enabled override. Browser logs contained no warnings or errors.
- The final full suite passed 76 tests and the structure checker reported five remaining, unrelated frozen-debt files.
