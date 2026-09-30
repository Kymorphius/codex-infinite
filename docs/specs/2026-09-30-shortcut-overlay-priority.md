# Shortcut toolbar overlay priority

## Request and evidence

The user reports that shortcuts show on New chat but disappear after entering an
existing conversation, and asks whether their display priority needs increasing.
The dedicated window has restarted but the backend is still the previous instance;
the committed read-only/old-composer recovery repair has not been loaded.

Executing the previous and repaired layout functions with the same selector-aware
fixture reproduces New chat showing, then a read-only or stale-old-composer route
hiding in the previous source. The repaired source stays visible and follows the
new surface. This is source evidence, not native-window acceptance.

A separate current-source defect is reproduced: a visible, explicitly nonmodal
role=dialog panel far from the toolbar hides it globally. Turbo settings, Turn State
and Claude settings use role=dialog popovers without declaring them modal. There is
no evidence that these specific panels caused the user's exact symptom.

Installed-bundle inspection also identifies two native composer adapters. The
Codex/home/thread adapter explicitly sets isFocusComposerTarget=true and hence
data-codex-composer=true on the rich editor. The ChatGPT conversation adapter
does not set that flag; its form instead exposes data-thread-find-composer=true
and data-composer-placement. The optional data-chatgpt-composer is omitted in
Work mode and must not be required. Its read-only mode
makes the form inert. Current layout ignores that form when no Codex marker is
present. This is a concrete compatibility gap, though the user's exact route has
not been inspected.

## Behavior and boundaries

Keep the toolbar's current page-chrome CSS layer. Raising z-index cannot overcome a
hidden attribute; do not raise it without evidence of a native stacking conflict.
Keep the native toolbar appearance, composer spacing, upward menus, read-only
navigation and sending authority unchanged.

Support both installed native adapters: keep existing Codex-surface selection and
add form[data-thread-find-composer="true"][data-composer-placement] as layout-only
candidates, covering ordinary ChatGPT and Work forms. A visible
ChatGPT form can anchor navigation even when its editor is not editable or the
form is inert. Hidden, disconnected, zero-size or old forms must not block the
next visible candidate; deduplicate, release owned spacing and follow remounts
as for Codex surfaces. Do not fall back to arbitrary forms, textareas or guessed
class names, and do not change the composer readiness/sending adapter.

True modal overlays yield the toolbar globally: aria-modal=true, native dialog in
the browser's modal top layer, and alertdialog authorization/error gates. Ordinary
role=dialog and nonmodal HTML dialog panels yield the toolbar only when their
visible bounds overlap its hit area, just as existing menus do. Owned toolbar
panels and distant nonmodal panels must not hide it. Preserve the previous hit
area while hidden to avoid repeated flashes, and recover when an overlapping
panel closes or moves away. Model/reasoning picker suppression remains unchanged.

Keep the change inside the existing DOM layout adapter and its focused tests; do
not add global polling or another observer. The existing serialized-source digest
must continue to replace an older installed controller when the backend reloads.
Do not modify the concurrently edited tab controller or unrelated popover modules.

## Verification and activation

Regression tests execute the actual layout function for distant nonmodal panels,
overlap and repeated hidden updates, panel close/movement, owned panels, native
modal top-layer dialogs, aria-modal=true and alertdialog gates. Retain composer,
terminal, overlay, stable spacing and installer-version regressions. Run repository
checks and the full test suite with bounded concurrency, then obtain fresh read-only
review and save only owned paths.

Cover New chat Codex composer to existing ChatGPT form and back, read-only/inert
form, old hidden form before a visible replacement, remount, cleanup and stable
style writes. Confirm generic forms and incomplete native marker sets are ignored.

Backend reload still requires the outstanding explicit confirmation concerning its
three owned Claude PTYs. External iTerm processes are separate and must remain
untouched. Native UI inspection is unavailable; activation and rendered acceptance
must be reported separately.

## Verification evidence

- Installed-bundle evidence comes from app-primary-92c16ff2fe4e.js and
  app-initial-74096abaa6b3.js for the two composer adapters and optional Work
  marker. app-shared-5d8e744d1fa1.js defaults its Dialog to modal and renders
  aria-modal accordingly; permissions-mode-dropdown-351dd9b4b531.js uses that
  default for its confirmation. No native layer conflict was established.
- Final focused layout, terminal and installer-version suites pass 25/25,
  including ChatGPT/Work crossed with home/thread placements. Independent
  read-only review reran them and found no blocker.
- Review also extracted the exact layout function embedded by the production
  builder, rebuilt it in an isolated VM and passed all 15 layout cases.
- The final production source passes `npm run check`: 865 syntax checks, a
  71-module graph and structure budgets for 909 files, with no budget increases.
- Full `npm test -- --test-concurrency=4` passes 1,963 tests, skips 14 and fails
  none (1,977 total). The subsequent test-only expansion from two form combinations
  to four was validated by the final focused and serialized-function runs; the
  production source did not change after the full run started.
- Source is 94 lines and the focused test file is 275 lines. Only the owned layout,
  its focused test and the two specifications changed. The old backend remains
  running with its three PTYs; no runtime activation or native visual acceptance
  is claimed.
