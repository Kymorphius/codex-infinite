# ChatGPT 26 bundled CLI compatibility

## Problem

ChatGPT 26.924 moved the bundled Codex executable from
`Contents/Resources/codex` into the versioned `codex-cli` resource directory.
The console still starts, but every feature that creates a short-lived app-server
process fails with `ENOENT`. This makes project discovery, account usage reads,
dispatch, project ordering, and native project import unavailable after the app
upgrade.

## Contract

- `CODEX_CONTROL_CODEX_PATH` remains authoritative when explicitly configured.
- macOS discovers the bundled CLI from a small ordered compatibility list:
  1. the new stable launcher at `codex-cli/bin/codex`;
  2. the new nested application executable;
  3. the legacy `Resources/codex` path.
- Discovery selects only an existing regular file. It does not execute candidates,
  inspect credentials, or mutate the application bundle.
- If no candidate exists, configuration retains the legacy path so downstream
  errors name a deterministic expected location instead of silently selecting an
  unrelated executable from `PATH`.
- Windows and Linux defaults remain unchanged.

## Verification

- Unit coverage proves preference order, nested-executable fallback, legacy
  fallback, deterministic missing-path behavior, and explicit override behavior.
- `npm run check` and `npm test` pass.
- On the installed ChatGPT 26.924 bundle, the resolved executable reports its
  version and can initialize the app-server used by the console.
