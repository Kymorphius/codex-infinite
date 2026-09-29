# Windows terminal overlay lifecycle integration

## Provenance and scope

Merge the Windows `95913c3-fix1` source delta against clean `95913c3` into
local `3f9f5ae`, preserving the newer GPT/Claude discussion and new-conversation
features. The source archive SHA-256 is
`01015d005639cd627b63fb82b9df152c29bf589f8d2970cfab1f0355d3cc40bc`.
Only three source modules and two regression files differ. Runtime directories,
device configuration, dependencies and credentials are not integration inputs.

## Required behavior

- Leaving the normal sidebar layout for settings cancels pending terminal
  navigation and restores the native workspace once per transition.
- The four main console entries do not seek an anchor outside the normal layout.
- Opening an embedded console panel disposes the previous native terminal view,
  releasing its title bar and hidden native content without stopping its PTY.
- If native navigation removes the terminal root, its observer disposes the
  orphaned view and restores the native header controls.
- Injection versioning includes the layout detector, allowing code replacement
  after a service refresh without retaining the prior layout closure.

## Integration and safety

Integrate only the reviewed delta in the existing isolated integration worktree.
The five changed paths have no local edits since the shared baseline. Preserve
the Windows checkout and running process unchanged. Do not deploy, restart,
push, change permission boundaries or copy per-device state in this task.

## Verification

Run the orphan-title regression, layout-transition tests, injection tests and
existing terminal lifecycle tests, followed by `npm run check` and `npm test`.
Confirm the helper remains executable in a serialized fresh VM, normal terminal
views are not disposed, and orphan cleanup releases the session adapter only.
Automated tests do not constitute visible Windows or macOS UI acceptance.

## Results

- Focused injection/native-terminal tests: 67/67 pass.
- `npm run check`: 781 syntax files, 67 browser modules and 821 structure
  entries pass, with no budget changes or frozen debt.
- `npm test`: 1633/1633 pass on macOS, including the newer collaboration
  discussion tests. No skipped or failed tests.
- Added integration assertions for connected roots, native-content restoration,
  idempotent adapter disposal, no PTY mutation, returning from settings and
  serialized layout detection in a fresh VM.
- The three production modules match the reviewed Windows delta exactly;
  only regression coverage and this provenance record were added locally.
- No Windows service switch, app restart, push or live UI acceptance in this task.
