# Native header label cleanup

The native header keeps the Jev control labeled `Jev` without exposing the
global-scope implementation detail in the visible pill. Turbo keeps its
configuration and million-context behavior unchanged, but the header pill does
not append a `1M` badge. The composer uses a text-only `百万` context button,
hides the native access-permission control, and keeps the existing access policy
unchanged. Turbo settings no longer expose an access-mode selector.

Composer actions use the compact labels `存待办` and `领任务`. The per-conversation
Jev control uses `路由` or `直连` without repeating the `Jev` prefix; routing and
direct-send behavior remain unchanged.

Tests verify that the generated native injection sources contain the simplified
Jev label and do not append the top-level Turbo `1M` badge.
