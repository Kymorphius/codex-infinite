# 0008: Trusted nodes see full execution transcripts

- Status: accepted
- Date: 2026-08-31
- Deciders: Codex Control Console maintainer and sole deployment user
- Related spec: `docs/specs/2026-08-31-full-fidelity-execution-transcript.md`

## Context

ADR 0002 and the first federated activity release excluded tool arguments and
results. That minimized disclosure but reduced a remote conversation to progress
commentary and operation counts. The product is now explicitly a personal,
trusted-device console, and its user prefers the exact owner transcript across
their configured Macs.

Execution records are arbitrary user and process content. Even when the console
does not read a credential store, a command or its output can itself contain a
secret. Pretending that this can be safely and completely redacted would also
make the view unreliable.

## Decision

Configured trusted nodes may receive the exact recorded input and output of
allowlisted tool-call and tool-result records. The UI renders that content as
plain preformatted text in an expandable card. It does not group away individual
operations or mask content.

This is a deliberate disclosure-boundary change, not a change to execution
authority. The owner desktop remains authoritative; transport remains owner
routed over SSH; HTTP remains loopback only; the browser does not receive SSH,
signing, Codex-auth, cookie, or credential-file contents from the console.

Hidden reasoning, encrypted content, authentication protocol records, system
prompts, and unknown record types remain excluded. Size bounds are explicit and
reported as truncation rather than described as a complete value.

## Alternatives considered

- Keep redacted summaries: rejected because the user cannot determine what a
  remote task actually executed.
- Heuristic secret masking: rejected because it creates false confidence and
  corrupts legitimate commands and output.
- Copy complete rollout files: rejected because it duplicates ownership and
  exposes unrelated protocol records.
- Unlimited payloads: rejected because one command could exhaust the dashboard
  or SSH process; explicit bounds preserve availability.

## Consequences

Anyone with access to a configured node's local dashboard or authenticated SSH
account can see recent execution details, including incidental secrets present
in those details. Adding another user, exposing a dashboard beyond loopback, or
supporting untrusted nodes requires a new access-control and privacy design.

The activity parser, peer contract, UI, tests, and product invariant wording must
distinguish infrastructure credentials from arbitrary execution transcript
content.

## Supersedes / superseded by

Narrows the redaction decision in ADR 0002 and the 2026-08-30 federated activity
spec for execution records only; supersedes no ownership or transport decision.

