# Control panel restart

Add a topbar button labelled 重启 next to Refresh. Confirmation explains that
current-device dedicated console, its backend, and injected enhancements restart
and running work in that window may be interrupted. It does not restart the OS,
other hosts, or the primary native GPT profile. It is an explicit user-triggered
operation; implementation/deployment must not trigger a full restart automatically.

POST /api/runtime/restart requires the exact dashboard Origin and JSON body
{confirm:true}; no client supplied PIDs, paths, commands or host targets. GET status
reports per-process instance ID. Coalesce repeated requests. Check the installed
service manager and exact dedicated profile before accepting. Spawn a detached
helper, then stop injector/scheduler recovery; helper revalidates profile, terminates
only the dedicated app tree, and restarts the fixed installed service. The helper
survives the service exit, bounds waits and logs failures. It waits for a new backend
instance plus native injection before reopening the panel. Primary app remains
untouched. Missing service registration or ambiguous CDP ownership fails closed.

Use launchctl gui/UID/dev.codex-control-console on macOS and existing interactive
Codex Control Console Scheduled Task on Windows. Never kill processes by name.
Windows package resolution first checks the current user, then the exact
`OpenAI.Codex` package registered for all users because a correctly installed
interactive package may be invisible to the detached background service context.
The fallback retains the exact package-name constraint and never selects an
arbitrary `ChatGPT.exe` from the filesystem or process list.
Both the request service and detached helper pass their bounded system-command
adapter through package resolution and process discovery. Missing adapters must
not be caught and misreported as a missing Windows package.
UI disables duplicate clicks, distinguishes acceptance from recovery, polls status
for a new instance and shows a timeout instead of reporting false success.

Validate profile mismatch, platform command targets, exact-origin and confirmation
checks, duplicate requests, execution order, and UI recovery with injected fakes.
Run npm run check and npm test. Deploy service/UI and verify button availability;
full restart validation must not interrupt ongoing user work without authorization.
