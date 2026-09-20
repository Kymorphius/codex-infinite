# macOS dedicated desktop launch

## Problem
Directly spawning the app executable attributes AppleEvents requests to the console Node process. Computer history fails with error -1743 because that responsible process lacks the automation entitlement.

## Design
Launch the configured app bundle using `/usr/bin/open -n -a`, passing the existing dedicated profile, loopback CDP switches, wrapper fingerprint and explicit wrapper environment with `--env` and `--args`. Do not reset permissions, modify signing, or change the ordinary app instance. Windows retains direct executable launch. Poll the real application process and verify its profile and fingerprint; the short-lived launcher PID is never reported as the app PID. Surface launch failures.

## Acceptance
Regression coverage proves macOS bundle launch, explicit environment forwarding, actual process ownership and launch failure handling; Windows launch remains covered. Run repository checks and tests. On both Macs restart only the dedicated app and verify native computer-history state and rendered settings. Existing machine configuration and user state remain intact.

## Verification (2026-09-08)
- Both Macs passed `npm run check` and all 538 tests.
- Dedicated instances restarted through LaunchServices; ordinary app processes remained running.
- Both native `chronicle.getState()` calls returned enabled=true, recorderState=running, activationState=idle, replacing AppleEvents error -1743.
- MacBook Pro settings loaded computer-history controls and existing history. User independently confirmed normal startup on the remote Mac.
- Device configuration and historical data were preserved; remote changed files backed up before deployment.
