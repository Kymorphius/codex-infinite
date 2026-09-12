# Reliable native project draft entry

Status: implemented and verified locally on 2026-09-12

## Problem

The project-search alias plus button reports that the native task entry is not
ready. The current native new-task scope and action contract are present, but
the adapter discovers its module only through Resource Timing. Those transient
entries can be cleared or unavailable while persistent modulepreload links and
the already loaded module remain available.

## Change

Discover the app-initial module from the current document's module scripts and
modulepreload/script-preload links first, then use Resource Timing only as a
fallback. Normalize and deduplicate URLs and admit only exact app://-/assets/
app-initial-*.js URLs without query, fragment, credentials or port. An ambiguous
document manifest remains an error. Validate the existing complete action and
scoped runtime before native invocation; never pin a bundle hash or export name.

The project alias still invokes the native action with only its exact mapped
local project identity. Native Chat/Work choice and draft initialization remain
owned by the app. The operation opens a draft and does not submit a prompt.

The draft's Chat/Work selector occupies a separate centered native header
container. Apply the existing 36-pixel tab inset to that inner home-mode-toggle
container as well as the conversation toolbar; keep its full-width fixed wrapper
and navigation side slots at their native position. This exposes the complete
mode switch below the tabs without reintroducing sidebar header overlap.

## Acceptance

- Empty timing records plus a valid persistent module link resolve the action.
- Duplicate references deduplicate; conflicting manifest entries fail closed.
- External, malformed and unrelated asset URLs are ignored.
- An old runtime without persistent links retains timing-based discovery.
- Click the affected project plus, inspect the native draft and exact project,
  and leave it unsubmitted.
- Run npm run check, npm test and scoped Git checks.

## Recorded verification

The affected `在 看板 中新建会话` search-result plus opened the native home draft
with `Change project: 看板`, an initially empty composer and no entry-error toast.
The current bundle and complete native action were resolved from modulepreload
while Resource Timing contained no app-initial record.

After the layout update, both Chat and Work controls begin at y=43, below the
tab strip's bottom at y=39. Both button centers hit their native buttons; the
global header still ends at y=46. A captured header image was visually inspected.
No prompt was submitted during verification. Full tests pass 606/606, with syntax,
structure and diff checks passing.
