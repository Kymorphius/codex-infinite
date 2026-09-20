# Jev automatic task routing

## Problem

Codex Router can classify a prompt with Jev and map the result to an OpenAI
model and reasoning effort. The independent enhanced console must expose the
same workflow without creating a second configuration authority.

## Product contract

- Add an `自动分流` module to the enhanced console.
- The user can edit the model and reasoning effort independently for four
  capability tiers: `quick`, `everyday`, `complex`, and `critical`.
- Both Codex Router and the enhanced console read and write the same versioned
  JSON document under the router state directory. This installation resolves
  it to `~/.codex-control-console/codex-router/jev-task-routing.json`; explicit
  router state-directory environment overrides remain authoritative.
- A prompt is sent to the local `jev` executable through stdin. Jev returns
  only the chosen tier and confidence; it never chooses a model directly.
- Confidence below the configured threshold, a missing executable, or a Jev
  failure uses the configured fallback tier and remains visible in the result.
- Dispatch creates a durable native Codex thread and starts its first turn with
  the mapped model and effort. Codex remains the conversation owner.
- The working directory must already exist. Prompt and subprocess output are
  bounded. No API key or credential content enters the browser, logs, or state
  document.

## API

- `GET /api/jev-routing` returns the normalized shared configuration and
  runtime availability.
- `PUT /api/jev-routing` validates and atomically replaces the shared
  configuration. Exact dashboard origin and JSON content type are required.
- `POST /api/jev-routing/dispatch` validates the prompt and working directory,
  classifies with Jev, creates the native thread, and returns the thread ID plus
  the classification and effective model/effort. Exact dashboard origin and
  JSON content type are required.

## Defaults

| Tier | Model | Effort |
| --- | --- | --- |
| quick | `gpt-5.6-luna` | `low` |
| everyday | `gpt-5.6-terra` | `medium` |
| complex | `gpt-5.6-sol` | `high` |
| critical | `gpt-6-astra` | `xhigh` |

Minimum confidence is `0.70`; fallback tier is `everyday`. Luna rejects
`ultra`, matching its advertised capability.

## Verification

- Domain tests cover defaults, normalization, model/effort compatibility,
  fallback behavior, and shared-state persistence.
- Adapter tests cover Jev stdin/arguments and native App Server requests.
- HTTP tests cover reads, exact-origin writes, updates, and dispatch output.
- Browser feature tests cover editable mappings and rendered routing results.
- The installed independent `加强版 ChatGPT` window visibly renders the new
  module and can read the same configuration as Codex Router.
