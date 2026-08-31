# Zotero Local API modularization

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: none

## Problem

`src/zotero-local-api.mjs` is 545 lines and combines write-input validation, public error mapping, editable-item projection, loopback request execution, authorization state, credentials, and four write workflows.

## Goals and design

- Move allowlisted write validation and identifier normalization to `zotero-write-validation.mjs`.
- Move header parsing, Local API paths, safe status mapping, JSON parsing, and editable-item projection to `zotero-local-contract.mjs`.
- Keep fetch execution, timeouts, authorization state, credential lifecycle, version preconditions, and write orchestration in `ZoteroLocalApi`.
- Preserve all request bodies, headers, response contracts, and one-time-key consumption.

The extracted modules are pure and must not import network, filesystem, credential, or process APIs. The main class remains the only component allowed to access credential values or transmit requests.

## Safety invariants

- Local API origin remains restricted to `127.0.0.1` over HTTP(S).
- Unknown fields fail before network access.
- Credentials never enter URLs, response bodies, or diagnostics.
- Updates retain the latest-version read and `If-Unmodified-Since-Version` precondition.
- Create operations retain random write tokens and non-destructive payloads; DELETE remains unavailable.

## Verification and acceptance

- [x] Pure validation/error/projection tests cover bounds, allowlists, identifiers, and secret-free mapping.
- [x] Existing authorization, exact-header, conflict, one-time-key, note, collection, and status tests remain green.
- [x] Every resulting file is within the default structure budget.
- [x] `src/zotero-local-api.mjs` is removed from frozen structural debt.
- [x] Full project checks pass and the real UI retains truthful write status.

## Shipped evidence

- The main class decreased from 545 to 336 lines; validation is 140 lines and the Local API contract is 74 lines.
- The full suite passes 84 tests, including exact headers, conflict prevention, one-time credentials, random write tokens, allowlists, identifier rejection, and editable-data projection.
- After restarting only the independent control-console service, the real UI still reported 2,337 items and 535 collections. With Zotero offline it truthfully disabled creation and displayed `Zotero 未运行`; browser logs were empty.
