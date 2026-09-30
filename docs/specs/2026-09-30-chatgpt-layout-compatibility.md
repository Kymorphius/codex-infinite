# Current ChatGPT native layout compatibility

## Scope and observed contract

Audit the installed ChatGPT 26.928.20755 (build 12246) native shell against the
enhanced sidebar, title/header, conversation shortcuts, composer controls, and
menus. Package inspection is static; it does not establish visible acceptance.

The packaged assets retain the main/header/sidebar and composer utility markers
used by the existing adapters, including the lazily loaded permissions control.
No selector or geometry change is justified by this evidence. Existing shortcut
layout reserves space beside the composer, follows resizing, and yields to native
dialogs, pickers, and overlapping menus.

The main document defines `--color-text`, `--color-surface`,
`--color-surface-secondary`, and `--color-surface-elevated`. It no longer declares
`--color-background-primary` or `--color-background-secondary`. Legacy fallback
backgrounds in enhanced controls can therefore combine a dark background with
native dark text in light mode.

## Required changes

- Use current native surface tokens for the conversation shortcut bar, recent
  conversation/sent menus, and native terminal model menu. Preserve native text
  tokens and the existing computed composer surface override.
- Apply the same surface correction to existing enhanced checklist, preferences,
  restart-needs, project-search/path/copy, discussion feedback, terminal-action,
  annotation, and unified-sidebar controls. Inspect concurrent draft controls
  separately; do not include their unrelated implementation in this commit.
- Use a foreground tint over the native surface for the selected unified-sidebar
  control; its legacy selected-background token is also absent in this host.
- Keep existing positions, reserved space, stacking, responsive rules, and
  keyboard/navigation behavior. Do not add a competing top strip or globally
  restructure native containers.
- Derive the conversation-tabs installer identity from its generated source so
  a changed stylesheet replaces the previous controller through its cleanup
  lifecycle. Repeated unchanged injection must still reuse the controller.
- Advance the existing fixed installer identities for affected auxiliary
  controllers. Recreate an older restart-needs entry with its subscription,
  stylesheet, and panel cleaned up even when the data store stays the same.
- Keep terminal injection's existing source/style-derived identity.

## Boundaries

No changes to native application resources, sessions, credentials, transport,
origin checks, terminal process ownership, or unrelated concurrent work. No
restart while the backend's four running Claude PTYs may be interrupted without
the user's activation decision. Computer Use denied access to this app; do not
use alternate automation to bypass that denial.

## Acceptance

1. A regression test verifies native surfaces and native text stay paired in
   light/dark themes, preserving all shortcut placement/stacking contracts.
2. A generated-source lifecycle test proves that different source content yields
   different installer versions and unchanged content yields the same version.
3. Existing shortcut resize, reserved-space, and native-overlay tests pass.
4. `npm run check` and `npm test` pass. Commit only owned, reviewed differences.
5. Report static compatibility, completed code, activation, and visual acceptance
   separately. Native visible acceptance remains pending in this session.

## Verification result

`npm run check` passed (832 syntax files, 69 graph modules, 874 structure files).
The final complete `npm test` run passed 1787/1787. An independent read-only
review found no actionable regressions and passed its 41 focused tests.

The running backend remains healthy and retains four running terminal sessions;
it was not reloaded. Native visual acceptance is still unavailable. The separate
untracked archive-control draft was preserved; its own legacy background tokens
still need correction when that concurrent feature is integrated.
