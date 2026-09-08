# 项目任务清单

## Behavior
Project context menus expose 任务清单. An owned dialog shows the selected project name, add form, editable task text, completion checkboxes, delete actions and pending/completed counts. Each project has an independent list keyed by its stable native ID and owning device where available. Cloud projects use their native project ID. Lists are local to each console installation. No task is dispatched automatically.

## Persistence and boundaries
A private atomic JSON store under wrapperCodexHome/project-checklists persists individual idempotent upsert/delete actions. The native document bridge is restricted to app://-/index.html. Project keys are hashed for filenames and never interpreted as paths. Pending actions survive renderer reload in localStorage; acknowledgement follows successful durable write. Input is bounded. Existing native project menu actions and React-owned nodes remain intact. Read errors must not cause overwrite. No native project or session files are mutated.

## Verification
Tests cover project isolation, updates/completion/deletion, duplicate replay, malformed input, corrupt-store preservation and native menu integration. Run npm run check and npm test. Verify native menu/dialog availability on deployed desktops.

## Delivered verification
Native/App Server project aliases are resolved read-only so search and sidebar menus share the same checklist. Background save acknowledgements preserve an active text edit. Full checks and 480 tests pass. Local and Windows runtimes receive the feature through the existing bounded native injection channel.
