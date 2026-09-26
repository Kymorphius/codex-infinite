# 0027: Terminal as a managed conversation provider

Status: accepted

The user requires CLI conversations inside the same project and conversation
management surface. A dashboard link into an independent terminal tool does not
meet that requirement. Native Codex records cannot truthfully represent a PTY.

We add a provider-owned persistent conversation registry and project references,
project its records into existing native sidebar and conversation tabs, and use
the existing main-area embedding host for one conversation at a time. Runtime
PTY IDs remain transient. Native records and credentials are not rewritten.

TaskCenter remains authoritative for all todos; provider is part of assignment
identity and native execution excludes terminal assignments. Opening or restoring
a view never creates a process or sends a prompt. Explicit user creation/start and
composer send are the execution boundaries. Archive and tab close retain runtime.

This introduces metadata persistence, not a second task store or a second model
client. The raw terminal remains fully interactive. Existing local transport,
exact-origin checks, bounded buffers and credential isolation remain unchanged.
