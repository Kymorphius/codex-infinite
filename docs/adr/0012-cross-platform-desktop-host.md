# 0012: Isolate platform-specific desktop hosting behind an adapter

- Status: accepted
- Date: 2026-08-31
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-08-31-windows-full-node.md`

## Context

The full-node architecture requires the complete native ChatGPT/Codex desktop
application on every owner. The current launcher embeds macOS process commands,
bundle layout, profile locations, and user-service assumptions. Windows supplies
the same product as a versioned MSIX package and requires different executable
discovery, process inspection, link semantics, and logon persistence. Spreading
platform branches through the composition root and domain services would weaken
the existing dependency direction and make safety checks inconsistent.

## Decision

Keep one platform-neutral dedicated-desktop lifecycle and introduce a focused
desktop-host adapter for executable resolution, bounded process discovery, and
platform launch metadata. Platform defaults remain in configuration; deployment
and persistence remain platform scripts. Domain, HTTP, peer, and UI contracts do
not depend on operating-system formats.

Windows resolves only the installed `OpenAI.Codex` package, runs the persistent
service as the signed-in user through Task Scheduler, and uses an independent
wrapper profile. A non-secret wrapper fingerprint appears in the process command
line as well as the environment so both macOS and Windows can verify ownership
without reading another process's environment. Windows deployment may create
only the existing allowlisted wrapper links; it never enables Developer Mode or
changes global symlink policy.

## Alternatives considered

- Duplicate the application into a Windows-specific fork: rejected because
  domain, HTTP, federation, and UI behavior should remain one product.
- Put `process.platform` branches throughout `src/main.mjs`: rejected because the
  composition root would acquire product and infrastructure logic.
- Run only App Server on Windows: rejected by ADR 0006 because it would not prove
  parity with desktop-hosted tools, approvals, plugins, and UI behavior.
- Reuse the ordinary ChatGPT profile: rejected because concurrent Chromium
  ownership causes profile locks and risks corrupting normal user state.
- Enable Windows Developer Mode automatically: rejected as an unrelated,
  system-wide security and policy mutation.

## Consequences

The launcher gains a testable provider boundary and Windows becomes a full peer
without changing normalized node contracts. Package and process discovery add a
PowerShell dependency on Windows, already present on supported hosts. Deployment
must validate link creation and interactive-session availability. New desktop
platforms require another adapter implementation but do not change domain or UI
modules.

## Supersedes / superseded by

Extends ADRs 0001 and 0006; supersedes no prior decision.
