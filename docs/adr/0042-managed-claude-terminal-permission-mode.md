# 0042: Managed Claude terminal permission mode

- Status: accepted
- Date: 2026-09-28

The user wants Claude conversations in the project/session terminal provider to
run without interactive tool approval. Pass `--permission-mode
bypassPermissions` when this provider starts or resumes its own Claude process.
This is a property of the launched Claude CLI process, not the terminal HTTP
service or the shared Shell provider. The terminal does not inject credentials,
copy account settings, or grant a Codex tool approval.

An attached daemon job already exists before this provider opens a viewer.
`claude attach` has no permission-mode option, so the viewer must preserve the
job's original mode instead of stopping or forking it to force a new one.
Codex-hosted Claude native-tool requests retain their separate permission
contract. Claude's managed settings, explicit deny rules and hooks remain in
force even when the CLI is launched in bypass mode.
