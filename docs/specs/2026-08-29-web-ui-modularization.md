# Web UI modularization

- Status: in-progress
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
  core/transport.js
  core/navigation.js
  features/sessions/index.js
  features/dispatch/index.js
  features/context/index.js
  features/priority/index.js
  features/zotero/index.js
```

Extraction order:

1. Sessions — recently changed, bounded, and already has a clear render/filter/event surface.
2. Priority and console — read-only consumers of the same normalized task state.
3. Dispatch and context — mutation-capable application features.
4. Zotero — largest feature and most security-sensitive UI boundary.
5. Shared formatting, transport, navigation, and final bootstrap cleanup.

Feature modules may import `core/*`; feature-to-feature imports are not allowed. The bootstrap creates shared services, loads data, and passes explicit dependencies to features.

## Security and privacy

No trust boundary changes. The browser continues to receive no credentials. Mutation requests continue to rely on exact-origin server checks. Session data remains read-only and native conversation opening continues through the parent-frame message contract.

## Rollout and rollback

Extract one feature per change while retaining existing behavior tests and real embedded UI inspection. Each extraction is independently reversible because contracts and markup remain stable.

## Acceptance criteria

- [ ] `public/app.js` is at most 250 lines and only composes modules.
- [x] Every extracted feature module is within the default structure budget.
- [ ] No feature imports another feature.
- [ ] Existing 46 tests continue to pass throughout extraction.
- [x] Sessions search, status filter, grouping, and native open flow pass real-UI verification.
- [ ] Dispatch and Zotero mutation behavior retains origin and credential protections.
- [ ] `npm run check` reports no growth in frozen structural debt.

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
