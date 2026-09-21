# Native header label cleanup

The native header labels the Jev control `路由` or `直连` according to its current
transport mode, without exposing the global-scope implementation detail. Turbo
keeps its configuration and million-context behavior unchanged, but its header
pill has neither a lightning icon nor a `1M` badge; right-clicking the Turbo
pill opens settings and no separate settings button is rendered. The composer uses a text-only `百万` context button,
hides the native access-permission control, and keeps the existing access policy
unchanged. Turbo settings no longer expose an access-mode selector.

Composer actions use the compact labels `存待办` and `领任务`. The per-conversation
Jev control uses `路由` or `直连` without repeating the `Jev` prefix; routing and
direct-send behavior remain unchanged. The composer keeps these controls in the
fixed visual order `存待办 → 领任务 → 百万 → 路由/直连`, independently of module
injection order. Holding Command on macOS or Ctrl on other platforms while
dragging one of these controls, including the queue-management `待办` control
and the current-conversation State indicator,
creates one shared local layout preference:
the latest order is used by every conversation panel in the current profile.
Ordinary clicks continue to invoke the control action and do not initiate dragging.
On conversation changes, the native access control remains hidden and the
custom composer controls are revealed as one settled group rather than flashing
into the toolbar one by one.

Tests verify that the generated native injection sources contain the simplified
Jev label and do not append the top-level Turbo `1M` badge.
