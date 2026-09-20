# Skill metadata discovery and on-demand copying

List and enablement operations read only SKILL.md and native enablement state.
Reference files are neither traversed nor hashed during discovery. Catalog hash,
fileCount and totalBytes are null when not inspected; the UI must not claim
content equality or show invented file counts. Existing hash-bearing peers remain
readable. Missing or unreadable SKILL.md is not a discoverable Skill.

Copy exports the complete folder on demand, including references and scripts.
The exported immutable package supplies its content hash. Existing targets are
exported at copy time to obtain the optimistic replacement guard; an export
failure prevents overwrite. Atomic installation, backups, link restrictions,
exact-origin checks and authenticated peer actions remain in force.

Support reference libraries with bounded packages of 2048 files / 32 MiB and
64 MiB encoded transport. Bounds apply to copying only, never list inclusion.
Oversized exports fail explicitly. Old peers may reject larger packages without
modifying the target. No unrequested automatic synchronization is introduced.

Verify metadata discovery with unsupported nested references, complete copying
above the previous limits, target change guards, UI unknown-hash rendering,
and npm run check plus npm test. Deploy and verify on Windows when reachable.

Validation: syntax and structure checks pass; all 523 tests pass. Regression
coverage copies all 149 files of a >2 MiB library, verifies its target hash and
repeat-copy no-op, preserves list visibility with an unsupported nested link,
and renders null catalog measurements without false synchronization claims.

Rollout: update consumers before metadata-only producers because older consumers
require catalog hashes. Deployed to mac-air, forest-mac and windows-pc through
the authenticated reverse SSH routes after direct LAN connections timed out.
Windows now lists 19 Skills including awesome-design-md. Verified the actual
Windows embedded skills page renders its name, complete description, enabled
state and copy button. Refreshed the embedded frame after reasserting CSP bypass
to recover a chrome-error page after service reload. No user Skills were copied
or replaced as part of deployment. Final checks pass with all 526 tests.
