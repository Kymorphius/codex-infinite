# Remaining native enhancement refresh overhead

## Request and boundaries

The user confirmed the Claude terminal recovered and asked to continue the
performance investigation. The previous installer, search/tool-row, session-scan
and SSH cooldown repairs remain in place. Inspect remaining repeated work using
static source, fake adapters, synthetic files/DOM and process samples. Native UI
automation is still unavailable. Preserve unrelated concurrent feature work and
the currently running managed Claude terminals.

## Project-name lookup

`createCurrentProjectNameLookup().nameFor()` currently flattens and copies all
project roots for each task, normalizes the same roots repeatedly and sorts the
matches. A listing with many tasks repeats this immutable work even though the
lookup is already tied to one project-state snapshot.

Prepare normalized roots in stable longest-first order once when constructing
the lookup. Normalize each query once and return the first containing root. Keep
Windows case rules, POSIX case rules, separator boundaries, stable ties, multiple
roots, worktree-name ambiguity and null results unchanged. A newly created lookup
must reflect new project state immediately; do not cache final task records or
change filesystem authority. Measure only synthetic lookup cost, not live CPU.

## Other candidates

### Concurrent native status reads

Attention refresh reads the same dedicated native runtime directly and through
the task adapter. A fake connection records two connects, evaluations and closes
for one refresh. Merge only unfinished raw status reads on the same adapter
instance. Each caller must normalize its own Map and independently preserve its
strict or permissive error policy. Clear pending state after success or failure;
the next request must read again. Never cache completed statuses or merge across
native hosts, and do not change mutations, drafts or approval reads.

### Claude listing registration scans

One listing of 20 synthetic Claude records with four registration files scans
the same directory 20 times, producing 40 realpaths, 20 directory reads, 80 lstats
and 80 file reads. Give only that list request a new registration snapshot; its
rows share the scan and filter their chain IDs while checking process liveness.
The next list scans again. Missing directories and failures must be retryable,
and a failed scan must not create an unhandled rejection or a retained snapshot.
Preserve injected/custom occupancy compatibility through the existing fallback.

Startup, takeover, settings application, mirror sending and mirror-turn waiting
must continue to read occupancy freshly through the existing action path. A list
snapshot must never become action authority. Read only bounded numeric JSON
registrations, retaining the current file and home-directory safety checks.

### Sidebar observers

A real terminal-provider/sidebar/model fixture with 1,000 React fibers and 500
unrelated body mutations produces 500 full model reads and 500,000 fiber visits,
plus 500 tab/search/recent refreshes. A full remote-sidebar injection fixture with
500 unrelated body mutations produces 1,000 section scans, 500 project clones,
500 thread clones, 1,000 icon clones and 500 unchanged order assignments, without
replacing the root.

Filter these observers to relevant native sidebar structure and selection,
terminal tab/placement changes, template changes, root removal and ancestor
remounts. Preserve explicit metadata acceptance and snapshot refresh, periodic
provider refresh, native-client replacement, bounded startup restoration, unified
sidebar switching and disposal. Do not cache the final React sidebar model or
change its authority. Ignore owned internal rendering mutations while retaining
external removal/movement recovery. Make an unchanged remote order assignment a
no-op. Use shared scoped DOM helpers where necessary to stay within file budgets.

Regression fixtures must execute the actual provider/sidebar/model and remote
injection functions. Unrelated body mutations should add no full model reads,
section scans, template clones or order writes. Relevant native fold/selection,
template and sidebar remount changes must still refresh; root removal, metadata
acceptance, repeated snapshots and unified mode must preserve recovery behavior.

Read-only parallel audits are measuring duplicated native-state reads, repeated
project-index queries, Claude registration scans and remaining DOM observer work.
Only a candidate with a concrete call path and reproducible operation counts may
be implemented. Add its scoped design before editing its source. Preserve fresh
security/action checks, error recovery, native ownership and input safety.

## Backend results

The three backend changes pass a combined 61-test focused run and independent
read-only cross-review. Native status coalescing reduces the Attention fixture's
connect/evaluate/close counts from two each to one each. Completed reads are not
cached, and mixed strict/permissive failures retain their own semantics.

The Claude list fixture's 20 registration scans become one: 2 realpaths, one
directory read, 4 lstats and 4 file reads. The next list immediately observes new
busy/idle status; later action checks refuse newly occupied sessions independently.
Failure, missing-directory, rewritten-registration, outside-home and legacy-reader
regressions pass. No actual Claude process was started or stopped for these tests.

Prepared project roots use 1,100 normalizations for 100 roots and 1,000 queries,
instead of repeatedly normalizing all roots per query. A paired five-sample
synthetic lookup benchmark with 100 projects and 1,735 tasks has median elapsed
time 251.35 ms before and 87.12 ms after. This is an isolated algorithm measurement,
not a native-window speed or CPU claim. An independent 1,200-query differential
check preserves the existing path results.

## Sidebar results

Both native builders serialize a shared mutation filter. It checks the changed
subtree, native fold/selection markers, sidebar ancestors and known owned-root
placement before scheduling work. Rendering keeps reading the live React model;
no final-model or template TTL cache was introduced. Remote placement writes its
order only when different and repairs external movement within the same parent.

The actual terminal builder/provider/sidebar/model fixture has 1,000 React fibers
and a mounted terminal row. Across 500 unrelated message-area child/class batches,
the old provider performs 500 model reads, 500,000 fiber visits and 500 refreshes
each for tabs, search and recent messages. The new provider performs zero of these
operations. A root-run comparison uses the provider from commit `56845b8` with the
same final fixture; this verifies the baseline independently of the implementation
lane. Six new regressions preserve native selection and bare fold controls,
ancestor visibility, tab coalescing, row removal/movement, ancestor remount,
explicit metadata acceptance, the 5-second refresh, client replacement and disposal.
Existing tests retain bounded startup restoration and request safety coverage.

The actual remote injection fixture records mutations from its own rendering and
drains them to a bounded settled state. Across 500 unrelated message-area batches,
the new implementation adds zero section scans, template/icon clones, style reads,
order assignments or subtree replacements. The earlier baseline recorded 1,000
section scans, 500 project clones, 500 thread clones, 1,000 icon clones and 500 order
assignments. Six new regressions cover repeated explicit snapshots, template
descendant/source changes, theme and ancestor visibility, native collapse/selection,
root removal/movement/order repair, remounts, temporarily absent sections, unified
mode transitions and repeated installation. The last fixture installs both actual
builders with a terminal row inside a native project list and an expanded selected
remote thread carrying a native selection marker. An external terminal descendant
class change settles after at most one remote render and one provider sync; the
next 500 message-area batches add no native scans, model reads or scheduled timers.
Independent review also checks an old injection upgraded while its RAF is pending:
it settles with one observer, one root and the intended order.

These are reproducible operation counts from synthetic page fixtures, not a claim
about observed native-window CPU or frame rate.

## Validation results

- `npm run check`: syntax 865 files, browser module graph 71 modules and structure
  909 files passed. No structure budget changed. The final remote subscription and
  dual-observer test also pass fresh syntax and structure checks.
- Final focused run: 62/62 passed across the three backend changes and both native
  observers, including the actual dual-builder fixture. Independent remote review
  passed 16/16 and found no blocking issue.
- A default-concurrency full run encountered one timeout in the existing real PTY
  output test: 1,946 passed, 14 skipped and one failed. The unchanged PTY test passed
  alone in 0.4 seconds. A complete subsequent `npm test -- --test-concurrency=4`
  passed with 1,951 passed, 14 conditional skips and zero failures. No timeout or
  production behavior was relaxed to obtain this result.
- Owned staged changes pass `git diff --check`. No native UI/CDP access or real
  managed Claude session manipulation was used for these validations.

Source validation is complete. Activation remains pending while three managed
Claude terminals are running. Restarting the backend reloads its code and changes
the content-derived provider installer version; remote installation has its own
new version. This does not establish rendered UI acceptance or live CPU savings.

## Validation and activation

Run targeted regressions, an independent read-only review, `npm run check`, and
`npm test`. Commit only reviewed owned changes. Report source validation separately
from activation. A backend restart disposes its managed PTYs, so do not interrupt
the currently running Claude sessions to activate these changes without specific
authorization for those sessions or confirmation that they have already exited.
