# 0019: Launch the macOS desktop through LaunchServices

Status: Accepted

The desktop host adapter launches the dedicated macOS application bundle through `/usr/bin/open`. LaunchServices establishes application responsibility for macOS privacy checks. Direct binary spawning can attribute AppleEvents to the background Node launcher, which has no automation entitlement.

Forward only the console-owned environment overrides explicitly through open, preserving dedicated profile and command arguments. Retain Windows direct spawning. Determine application identity through process discovery and fingerprint checks, never the open process PID. Do not work around this boundary with TCC database changes, ad-hoc signing or disabled security.
