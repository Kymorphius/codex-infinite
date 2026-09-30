# Current ChatGPT compatibility and GPT-6.1 Sol

## Problem and evidence

The installed macOS host is ChatGPT 26.928.20755 (build 12246) with bundled
Codex CLI 0.159.0. Both the original and dedicated enhanced processes launch
from `/Applications/ChatGPT.app`; the enhanced process retains its dedicated
profile and wrapper signature. After the update, the enhanced native cache and
Router merge both advertise `gpt-6.1-sol` with `visibility: list`.

The enhanced Jev settings still use fixed model lists that omit this new model.
Even with an updated native picker, saving a Jev mapping to GPT-6.1 Sol fails
validation or loses the mapping during presentation normalization.

## Intended behavior

- Add GPT-6.1 Sol to backend routing validation, native routing settings,
  native snapshot presentation, model-change labels, and dashboard settings.
- Advance the native Jev installer version so backend reload updates the panel
  in an existing host document through its normal cleanup/reinstall lifecycle.
- Accept the native Codex effort levels observed in the current cache:
  `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. These are the native
  client contract; public API documentation does not advertise `ultra`.
- Preserve all existing mappings and defaults. Adding a model does not select it
  automatically, enable routing, or change the current conversation.
- Keep Turbo model options driven by the existing native catalog. Verify that
  GPT-6.1 Sol survives its adapter and policy selection without adding a static
  Turbo catalog or imposing a context size from a different model.
- Continue using the current installed app and bundled CLI paths. Do not copy
  another profile's merged models or alter native application resources.

## Boundaries and delivery

No changes to credentials, native session/database ownership, origin checks,
transport, app permissions, discovery, or unrelated concurrent edits.
Backend-only reload may be used to load the completed compatibility changes
while keeping the dedicated host process and ongoing native tasks alive.

## Acceptance

1. Routing configuration round-trips GPT-6.1 Sol mappings and rejects invalid
   efforts such as `none` and `minimal`.
2. Native and dashboard routing settings expose the exact model and supported
   effort set. Native snapshot/labels retain its identity.
3. The catalog/Turbo pipeline accepts the current native GPT-6.1 Sol metadata.
4. `npm run check` and `npm test` pass, or pre-existing unrelated failures are
   explicitly recorded. Only reviewed task-owned differences are committed.
5. Running service/catalog evidence is checked after deployment. Actual native
   UI acceptance remains separate: Computer Use denied `com.openai.codex` in
   this session, so no CDP/AX workaround is used to bypass that denial.

## Current runtime constraints

The original and enhanced native caches plus Router merge now contain GPT-6.1
Sol. The running Turbo service was seeded before the app update; its catalog was
refreshed through the existing local save API using its unchanged model value.
All user-controlled Turbo fields were compared before/after and remained equal.
The response now contains GPT-6.1 Sol and its six native effort choices.

The backend owns four running Claude PTYs. Its shutdown disposes these PTYs, so
even a backend-only reload requires resolving this interruption with the user.
Finish verification and Git saving before requesting the activation decision.
