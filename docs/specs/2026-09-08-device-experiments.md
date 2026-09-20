# Device experiments

## Goal
Add a read-only 实验 page showing Codex native experimental features and Control Console extensions, grouped by configured device. Default to enabled entries, with an option to show all. Display source, stage, count and observation time. No toggle or configuration mutation is included.

## Sources and ownership
- Native: query the running owning desktop through its existing Electron bridge using paginated `experimentalFeature/list`. Never start a replacement app-server or infer effective state from TOML. Exclude stable/removed/deprecated native features from the experimental inventory.
- Console: a bounded named inventory checks live injected extension objects/functions and explicit enabled state. Loaded extension capability does not imply a per-task policy is active; descriptions must state this distinction.
- Local normalized snapshots use `/api/node/experiments`; aggregation uses `/api/experiments` and existing authenticated SSH transport for configured peers. Older/offline peers explicitly report unavailable. No recursive aggregation.
- Only allowlisted metadata leaves adapters. No credentials, raw config or session content. Each category can fail independently, and unavailable state must never become an empty success.

## UI and verification
A standard navigation tab supports initial URL selection, activation refresh, manual refresh, loading, per-device/category errors, empty states and enabled/all filtering. Text is rendered with textContent. Tests cover pagination, projection, mixed availability, transport and rendered filtering; run repository check/test and inspect a rendered live-data page.

## Verification (2026-09-08)
- Repository syntax/structure check passes; full suite: 537 passed.
- Live local owner reports 54 non-stable native features, 2 enabled (`chronicle`, `context_management`), and 8 registered console extensions loaded.
- Live dashboard rendered through Chromium: enabled/all filtering shows 10/62 entries, no page errors, no horizontal overflow at 390px. Configured MacBook Pro and Windows peers currently report unavailable; deployment to those devices is outside this change.
- Local background console service reloaded without restarting the desktop application.
