# Conversation shortcut toolbar recovery

## Request and evidence

The user reports that opening an occupied conversation hides the floating
message-search/recent-conversation/recent-sent toolbar, and opening a free or new
conversation does not promptly restore it. It later recovered without a code
change or service restart. Native UI inspection is unavailable; the exact rendered
DOM state is unobserved.

Executing the actual layout function in isolation reproduces two relevant paths:
a connected, visible read-only native composer is excluded by the editable-only
selector; and a hidden old composer preceding a visible new composer is always
chosen by the first-match query. The latter stays hidden across explicit updates
and resize callbacks until the old DOM is removed. Neither path establishes that
the user's exact window followed it, but both violate the toolbar anchor contract.

## Design and boundaries

Choose the shortcut toolbar anchor by visible composer surface, independently of
whether typing is allowed. Inspect only the native composer marker, map candidates
to their surface, deduplicate surfaces, and skip disconnected, hidden or unusable
geometry before selecting a visible surface. Keep the existing terminal composer
route and overlay suppression. Read-only navigation must not authorize sending,
takeover, task assignment or change native composer readiness.

When the current surface is moved outside a small viewport by its own reserved
toolbar spacing, keep that reservation only if subtracting the owned spacing puts
the connected, visible, positive-size surface back in view. Real in-view candidates
always take priority. Determine toolbar visibility using the actual geometry. This
prevents repeated updates from releasing and restoring the same spacing, without
allowing an old offscreen surface to block a new visible composer.

Preserve real reserved spacing, native appearance, upward menu placement, stable
style-write guards, cleanup and observer ownership. Keep all DOM logic in the
existing layout adapter. Do not add global polling or read the React model. Do not
edit the concurrently modified tab controller. Its existing source digest includes
the serialized layout function and changes both inner and outer installer versions
when the service loads the repaired source.

## Validation and activation

Regression tests execute the actual layout function with realistic candidate lists:
visible read-only composer, editing-state changes, hidden old composer before a new
visible composer, removal/remount and existing terminal/native transitions. Retain
the dialog/model/menu suppression and spacing tests. Repeated update/resize calls
in a small viewport must preserve owned spacing without repeated style writes;
viewport recovery and a newly visible candidate must restore or re-anchor the bar.
Verify serialized source and installer digest behavior, run `npm run check` and
the full test suite with bounded
concurrency, obtain read-only review, and commit only owned paths.

Do not interrupt the currently running managed Claude terminals. Service activation
shares the outstanding reload confirmation from the preceding performance fixes;
the user's report or spontaneous UI recovery does not authorize that interruption.

## Verification evidence

- The focused layout, terminal shortcut and installer-version suites pass 20/20;
  independent read-only review reran them and found no remaining blocker.
- Running the previous layout against the new realistic fixtures fails four
  behavioral assertions (read-only anchoring, old hidden surface selection,
  removal/remount and terminal-to-read-only transition), without missing-API errors.
- The small-viewport regression executes 20 update/resize calls with stable owned
  spacing and no repeated style writes, then verifies viewport recovery and new
  candidate priority.
- Final `npm run check` passes syntax validation for 865 files, the 71-module graph
  and the structure budget for 909 files, with no budget changes.
- Final `npm test -- --test-concurrency=4` passes 1,955 tests, skips 14 and fails none
  (1,969 total). Both commands ran after the final viewport repair.
- Native window acceptance remains unobserved. The service instance is unchanged
  and its three managed Claude terminals are still running; no activation occurred.
