# Loopback static asset boundary

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-29
- Related ADRs: none

## Problem

`src/http-server.mjs` owns API routing and the complete static-file policy. Every extracted browser feature currently requires another route, MIME declaration, filesystem read, and security response in that already near-budget service file. The policy is implicit and lacks focused tests for traversal attempts, `HEAD`, MIME types, and security headers.

## Goals

- Give a focused module sole ownership of the public asset allowlist and successful asset responses.
- Serve only explicitly registered files below `public/`.
- Reject raw or percent-encoded dot-segment traversal before URL normalization can hide it.
- Preserve current `GET`, `HEAD`, 404, 405, MIME, cache, CSP, and `nosniff` behavior.
- Reduce `src/http-server.mjs` and ratchet its file-specific structure budget.

## Non-goals

- No arbitrary directory serving, directory listing, fallback routing, or dynamic MIME inference.
- No caching, compression, bundler, UI, API, authentication, or network exposure changes.
- No change to the public URL of an existing asset.

## User experience

The dashboard looks and behaves exactly as before. Known page and feature assets load normally. Missing or suspicious paths return a JSON 404, and unsupported methods return a JSON 405. `HEAD` reports the same successful headers as `GET` without sending a body.

## Contracts and data

The registered URLs remain `/`, `/index.html`, `/styles.css`, `/app.js`, and `/features/{console,priority,sessions}/index.js`. Static responses retain `no-store`, `nosniff`, and the existing content security policy. No persisted data changes.

## Design and ownership

`src/static-assets.mjs` owns the immutable URL-to-file manifest, raw-target validation, trusted path resolution, file reading, MIME selection, and successful response. `src/http-server.mjs` continues to own method policy and JSON 404/405 responses, then delegates a permitted read to the static module. The static module does not import the HTTP server or any API feature.

## Security and privacy

Only exact allowlist matches are readable. The module examines the unnormalized request target and rejects decoded `.` or `..` segments. Absolute filesystem paths are derived only from trusted manifest values; user input is never joined to the filesystem. Existing loopback binding and CSP remain unchanged.

## Rollout and rollback

The extraction is activated by the normal local service restart. It is behavior-compatible and can be reversed by restoring the manifest and response block to `src/http-server.mjs`; no data migration is involved.

## Acceptance criteria

- [x] Every existing static URL returns its existing MIME type and security headers.
- [x] `HEAD` returns no response body.
- [x] Unknown, raw traversal, and encoded traversal targets cannot read a file.
- [x] Static `POST` remains 405 and missing `GET` remains 404.
- [x] Full tests and structure checks pass.
- [x] `src/http-server.mjs` has a lower file-specific budget than the global source limit.

## Verification plan

- Unit: manifest resolution, query handling, dot-segment rejection, MIME, headers, and `HEAD` body behavior.
- Integration: start an ephemeral dashboard and verify known, missing, traversal, and unsupported-method requests.
- Real UI: reload the running dashboard and verify its extracted feature modules render.
- Structure and regression: run `npm run check` and `npm test`.

## Shipped deviations

- Added optional `fileLimits` support to the structure checker so a healthy file can be ratcheted below the global default without incorrectly labeling it frozen structural debt.
- `src/http-server.mjs` moved from 342 lines and 16,004 bytes to 318 lines and 14,715 bytes; those new values are its file-specific ceilings.
- `src/static-assets.mjs` centralizes seven exact public routes and rejects malformed or decoded dot-segment paths before reading.
- Added four focused tests; the complete 55-test suite and both structure checks pass.
- Restarted the loopback service and verified the real session center with 1 device, 18 directories, and 160 sessions. The browser console reported no warnings or errors.
