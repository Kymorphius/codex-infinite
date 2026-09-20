# Native header label cleanup

The native header keeps the Jev control labeled `Jev` without exposing the
global-scope implementation detail in the visible pill. Turbo keeps its
configuration and million-context behavior unchanged, but the header pill does
not append a `1M` badge. The million-context option remains available in the
Turbo settings popover and in effective-strategy details where it is useful.

Tests verify that the generated native injection sources contain the simplified
Jev label and do not append the top-level Turbo `1M` badge.
