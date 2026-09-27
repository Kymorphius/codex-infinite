# 0029: Native terminal Runtime transport

- Status: accepted
- Date: 2026-09-27

ADR 0028 prevents loopback frames and late CSP bypass in macOS ChatGPT 26.
The user requires terminal conversations inside project and conversation management.
Use an allowlisted Runtime transport and directly mounted packaged terminal view,
with per-execution-context validation and stream ownership. Reuse existing
conversation and PTY services; do not expose arbitrary HTTP, process or file APIs.

This extends ADR 0028 for terminal conversations only. Other dashboard modules
continue to launch the standalone application. Browser origin checks remain
unchanged; the native transport has its own explicit top-level app context check.
