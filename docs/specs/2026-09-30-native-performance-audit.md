# Native enhancement performance audit

## Request and scope

The user confirmed GPT-6.1 Sol appears after the dedicated-host restart, reported
the native dot still below project search, and requested a performance check and
repair of confirmed problems. Dot placement has a separate spec. This work owns
bounded idle/streaming overhead in enhancement installers and refresh paths.
Preserve existing dirty feature work and all process, credential and session
boundaries. No native UI access is authorized for this audit.

## Evidence

- The real Claude tool-row installer writes the same stylesheet and appends it
  to head before checking its version on every backend sync. Initial installation
  plus ten identical reinstalls produces eleven stylesheet writes, eleven head
  appends and eleven full timeline scans. It also retains both a scheduled and a
  direct compact subscriber after the first reinstall.
- Project search observes all document child changes. A closed search receives
  500 unrelated timeline changes and performs 500 computed-style reads despite
  no placement change. Its unchanged-state guard currently runs after ancestor
  backdrop reads, floating-style writes and full snapshot serialization.
- Backend and native process samples and safe HTTP timings are supporting runtime
  observations, not proof of a specific renderer bottleneck or UI acceptance.
  A separate read-only audit checks repeated backend installer/index work.

## Requirements

1. Repeating an unchanged tool-row installer must not replace or move an already
   correct stylesheet, rescan the full timeline, or add a duplicate subscriber.
   Upgrades and document/remount recovery must still install the current version.
2. Unrelated sidebar/composer changes must not scan the Claude timeline. Timeline
   updates and notice state changes must continue to render and compact safely.
3. Project search should react to relevant sidebar placement/template changes,
   explicit data/query updates, document remounts and theme changes. Unrelated
   timeline streaming must not read its backdrop or serialize the whole catalog.
4. Repeated settled refreshes should avoid computed-style reads and CSS writes.
   Preserve search query, expansion, scrolling, keyboard actions, and existing
   shortcut-tail placement and project-section fallback.
5. Any backend optimization must preserve dynamic snapshot delivery, per-context
   installation/version recovery and all current safety boundaries. Add only
   when a concrete repeated-work mechanism and meaningful regression are proved.

## Bounded backend metadata reuse

Every task listing currently traverses both session trees and stats every JSONL
file before enriching tasks. Sequential requests from the same refresh cycle
repeat this directory and metadata work even though file parsing is already
cached. The title index also reads and parses its complete JSONL content on each
request; companion title lookup has a separate weaker mtime/size cache.

Use one title-index reader with a signature including device/inode, size,
modification time and change time. Coalesce overlapping stat/read operations,
reuse the parsed title map while the signature matches, and return a defensive
map to task-list callers. Deletion, replacement or a failed read clears the
stored parse; errors remain retryable.

Cache only sorted session paths and their stats for 250 ms, capped at 500 ms.
Coalesce overlapping metadata scans and rescan active and archived directories
after expiry, including an empty result. Never cache scan failures. The adapter
still reads native runtime status, context overrides, title index, active-session
settings and project enrichment for every listing. Existing parsed-file caching
uses the metadata signature; a failed task read invalidates the metadata cache
so the next request retries discovery. Do not cache the final task snapshot or
change task sending. Inject the filesystem and clock for deterministic operation
counts, expiry, replacement, discovery and failure tests.

## Validation

Use isolated fixtures with operation counts, including real first install followed
by repeated installs; unrelated mutation bursts; relevant timeline/sidebar changes;
theme/remount recovery; and unchanged versus changed snapshots. Record live CPU,
memory and endpoint timing observations without attributing unmeasured gains.
Run focused tests, `npm run check`, full `npm test`, and a fresh read-only review.
Save owned changes locally and report activation separately from visual acceptance.

Backend focused validation passes 36 tests. Eight simultaneous title readers use
one stat and one content read; the next unchanged read stats once and does not
reread content. Six simultaneous scans of a fixture with active, nested and
archived directories use three directory reads and three stats; sequential reads
within 249 ms add no discovery operations, and the 250 ms boundary rescans.
Three same-window task listings reuse one discovery/parse while each rereads
runtime state, titles and project relations. Active settings and context changes
are visible immediately. A session removed after discovery causes one failed
listing, invalidates metadata, and the next request discovers the removal at the
same clock time. These counts demonstrate avoided repeated work; they do not
claim an unmeasured CPU or latency improvement in the native window.

## Backend installer cache design

Cache static installer source arrays and their digest in a connection-keyed
WeakMap. A stable role/config key includes the butler directory or dashboard
binding where relevant. Each warm cycle sends a small renderer marker probe with
critical function/style readiness and version fingerprints; it does not rebuild
or retransmit the source arrays when that probe matches. A replaced document
loses the marker, and a changed readiness fingerprint forces replay immediately.
An unsuccessful evaluation never marks the cache installed. A maximum 30-second
installation age forces bounded replay for components outside the readiness probe.

Snapshots, project path menus, queued actions, binding registration and terminal
runtime preparation retain their current per-cycle behavior. Dedicated and owner
roles use independent keys. Preserve document-start registration, CSP/reload
policy and same-target document replacement recovery. No new DOM access is used
for validation: use fake connections and VM documents, including changed data,
lost module/style/version, failed evaluation, force/config changes and reconnection.

Installer validation uses eight helper tests and four fake connection/VM
integration tests, with 35 focused tests including existing injector recovery,
binding, CSP and terminal-runtime ordering coverage. A failed replay invalidates
the previous install timestamp before its first script; partial repair, forced
replay and probe failures therefore retry instead of trusting an older marker.
Terminal preparation runs each cycle and immediately precedes a full shell replay.
Shell entry readiness uses the same normal-layout and eligible native anchor rules
as installation. A hidden/unmounted sidebar or visible pane without an eligible
anchor is a legitimate wait state. Existing entries avoid anchor scans; a missing
Close function only requires immediate repair while a console workspace exists.

For identical empty snapshots and current static builders, the pre-change warm
dedicated cycle sends 36 evaluations / 645,638 UTF-8 script bytes; caching sends
15 / 17,971. The native owner cycle changes from 31 / 427,876 to 10 / 1,869.
These are offline transmitted-source counts, not live CPU or latency claims.
Dynamic context/project snapshots, actions and binding registration remain fresh;
same-connection document replacement, missing components/styles/version changes,
failed installation, config changes and the 30-second recovery boundary are covered.

## Delivery verification

The final working tree passes `npm run check` and all 1,866 tests. An isolated
clean HEAD export with only the staged owned changes passes the full syntax,
module and structure check and all 137 focused tests. This verifies that the
committed injector projections do not depend on unrelated dirty Butler/TopAction
work. A fresh read-only review reports no remaining correctness findings.

Closed search fixtures avoid all backdrop reads and full catalog serialization
for 500 unrelated mutation batches. Repeated tool-row installation now performs
one stylesheet write, one head append and one initial scan across eleven calls;
500 unrelated sidebar mutations add no full timeline scans. Failed SSH read routes
retain a bounded cooldown even when the fallback succeeds, avoiding retry and log
storms without changing mutation routing or peer failure handling.

Activation fully restarted the dedicated native host and backend service, retiring
previous private observers that cannot be safely identified during a hot upgrade.
The exact dedicated profile, changed host/service processes and new backend
instance were confirmed; the original native host remains running. There were no
service terminals before or after restart. Health, runtime status and model-policy
requests all returned HTTP 200. Follow-up endpoint samples were about 1-6 ms;
the first fresh health connection took about 37 ms. GPT-6.1 Sol remains available
with all six configured reasoning levels. New service logs contain no syntax,
reference, type or missing-module errors.

Runtime health and process ownership are separate from visual sidebar acceptance.
The affected-window position of Alfred still awaits user confirmation. Short
process samples do not establish long-term memory behavior or a causal reduction
in overall CPU load.
