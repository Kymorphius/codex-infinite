# Static HTML fragment composition

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: none

## Problem

`public/index.html` owns the application shell and all six feature panels. At 368 lines and 30,287 bytes it is frozen structural debt, and unrelated UI changes share one large markup file.

## Goals

- Keep the browser startup contract synchronous: the first HTML response already contains every panel required by `app.js`.
- Give board, context, console, sessions, priority, and Zotero bounded markup files.
- Keep fragments private implementation files rather than new public routes.
- Preserve the exact rendered DOM, CSP, loopback binding, and static allowlist behavior.

## Design

`public/index.html` becomes the document shell with one exact `<!-- MODULE_PANELS -->` marker. Feature markup moves to `public/panels/*.html`. The trusted static-asset adapter reads only the fixed fragment list and replaces the marker before returning `/` or `/index.html`. There is no client-side fetch, template interpretation, path input, or dynamic fragment discovery.

The assembler fails closed when the marker is absent or duplicated. Panel fragment paths are fixed at module initialization and are not individually registered as public assets.

## Non-goals

- No visual or content changes.
- No client-side template loader or build system.
- No user-controlled include paths.
- No CSS or JavaScript feature refactor.

## Verification

- Unit tests cover exact ordered composition, missing/duplicate marker rejection, and fragment route denial.
- Existing static HTTP and security-header tests remain green.
- Full structure and regression suites pass.
- Real embedded UI checks every module is present and confirms no browser errors.

## Acceptance criteria

- [x] `public/index.html` and every panel file stay within the default structure budget.
- [x] `/` and `/index.html` return one complete synchronous document in stable panel order.
- [x] Panel files are not directly public.
- [x] Visible behavior and security headers are unchanged.
- [x] `public/index.html` is removed from frozen structural debt.

## Shipped evidence

- The shell is 40 lines; the six fragments range from 32 to 121 lines and all remain below 24 KB.
- The structure checker reports four remaining frozen-debt files instead of five.
- The full suite passes 78 tests, including ordered composition, marker failure, private route denial, and HEAD behavior.
- A fresh real server response exposed six module controls and six panels. Every module switched successfully; sessions still reported 160 conversations and Zotero still reported 2,337 items. Browser logs contained no warnings or errors.
