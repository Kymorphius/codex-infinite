# Recover Windows projects missing after native-home migration

## Evidence and behavior

WorldManager exists twice in native project/list and in the old wrapper desktop
state but not in the active desktop's local-projects. The active renderer reads
43 records from the source home, while the retained wrapper has 47. Native data
was switched to a single lexical Windows home to protect SQLite, but wrapper-only
legacy sidebar records were never migrated back. New-project aliases must not be
mistaken for proof that the native sidebar contains a project.

Recover missing legacy project records and their native ID mappings via the
running desktop's get-global-state/set-global-state bridge, which notifies its
renderer. Only recover candidates whose mapped native server record still exists
and exactly matches name and normalized root set. Keep existing active records,
map entries and native section memberships untouched. Do not merge/delete same-root
projects: repeated creation may have distinct tasks. Preserve backups before
mutation. Read back both bridge state and on-disk state, then verify native rows
and persistence after a dedicated application restart with no active turns.

Provide a bounded, explicit repair script, never an automatic periodic union:
periodic merging could resurrect deliberate deletions. No direct SQLite writes.
Future creation continues through the native desktop, in its current source home.
Regression tests cover missing records, deleted server IDs, mismatched roots,
existing mapping conflicts and preservation of existing entries.

## Restart finding

The first native-interface repair read back 47 records and showed both WorldManager
rows, but a dedicated-shell restart reverted the shared JSON and renderer to 43.
This is not a completed repair. The normal desktop was still running with its
earlier cached state. Native persistence writes the entire in-memory global-state
map, so simultaneous desktop shells sharing the same home can overwrite a newer
project list. Validate both owners' cache lifecycle before claiming persistence;
a source-file update alone is insufficient. Do not stop an uninspected ordinary
desktop with potentially active work.

## Recovery after authorized official restart

User authorized restarting the official Windows desktop. Stopped its old process
and children, reapplied the four validated sidebar records through the dedicated
native bridge, and relaunched the official window in the interactive session.
Its loopback CDP bridge uses the already-configured primary port 9232. Removed the
temporary launch task and path file afterward.

Readback before and after a further full dedicated-shell restart: source JSON 47,
dedicated live query 47, official live query 47; both windows render both preserved
WorldManager native rows under Projects. A repeated recovery dry-run has no
remaining candidates. Backup:
C:\Users\Admin\.codex\.codex-global-state.json.before-project-recovery-1788588314231.

This validates recovery from the observed stale cache, not a redesign of native
cross-process global-state persistence. Concurrent desktop writers still share
that underlying native behavior; no untested periodic union or automatic project
deletion was introduced.
