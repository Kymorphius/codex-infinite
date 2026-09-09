# Hermes read-only GPT work context

## Purpose

Hermes must discover existing GPT projects and conversations before asking the
user to repeat project context. Keep Hermes' own agent loop and learning stores;
this integration provides retrieval tools, not an alternative executor.

## First delivery

- A local stdio MCP server with project listing, conversation search, and
  paginated conversation reading (including literal search inside a conversation).
- Read the configured native Codex project/thread database in read-only mode and
  resolve transcripts from its recorded paths. Honor current project membership
  and current titles instead of treating the initial working directory/title as
  authoritative. Include empty projects. Exclude internal subagent conversations
  by default; archived user conversations are an explicit option.
- Scope is this machine's persisted Codex conversations in the GPT desktop app.
  ChatGPT web/cloud histories and other hosts are not silently represented as
  covered. Every result includes its scope and source identity.
- Use stable project/conversation identifiers. Return original titles, dates,
  project membership, and citations to conversation/message identifiers.
- Read human messages and public assistant messages only. Do not return system
  instructions, developer instructions, reasoning, raw tool traffic, auth files,
  or machine-injected context-only user records.
- Bound input, output, and transcript I/O. Long histories return an older-page
  cursor; no empty or truncated page may be presented as the entire history.
  Search is literal text, never executable code or a caller-provided file path.
- MCP tool descriptions identify retrieved history as untrusted source material,
  not new commands or authority. Expose no send, resume, edit, delete, or approval
  tool, and open no listening network port.

## Ownership and module boundaries

- `gpt-context-catalog`: filesystem/SQLite adapter for current project/thread
  metadata and allowed transcript path resolution.
- `gpt-context-transcript`: bounded, read-only transcript I/O and public-message
  projection, with file-bound pagination.
- `gpt-context-service`: normalized retrieval contract, filtering and pagination.
- `gpt-context-mcp`: MCP tool schema/dispatch and bounded stdio transport.
- `scripts/hermes-context-mcp.mjs`: composition entry point only; reuse configured
  Codex paths, with no application startup or mutation side effects.
- Hermes' existing configuration gains one stdio MCP entry. Preserve all existing
  model, memory, skills, credentials and other MCP configuration. Machine-specific
  installation paths remain local; the repository contains a generic example.

The native database and transcripts remain authoritative. The bridge does not
copy raw histories into another store or write directly to Hermes memory. Model
calls remain Hermes' existing provider's responsibility. Native UI routing and
the active native app-server are unaffected by retrieval.

## Acceptance

1. Protocol tests verify MCP discovery and calls, malformed input, unknown tools,
   and the lack of mutation tools.
2. Fixture tests verify project membership/title precedence, empty projects,
   archived/internal filtering, path confinement, and missing storage errors.
3. Transcript tests cover private-message exclusion, UTF-8, large history,
   truncation, backwards pagination without gaps/duplicates, file replacement,
   and bounded literal search.
4. Run `npm run check` and `npm test`.
5. In the actual Hermes client, discover the installed tools and use them to find
   the current project and the current Hermes-integration discussion. Hermes must
   summarize the agreed Multica/Hermes division and outstanding learning/persistence
   validation, citing retrieved messages. Do not seed the expected answer in the
   verification prompt. Record the observed outcome separately from protocol tests.

## Deferred

Cross-host/cloud retrieval, executing tasks in existing GPT conversations,
automatic learning writeback, and kanban synchronization are separate changes.
