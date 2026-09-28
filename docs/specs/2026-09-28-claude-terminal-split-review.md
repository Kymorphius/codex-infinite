# Claude terminal split review

A managed Claude terminal currently fills the conversation surface. While Claude
shows a large code diff or other full-screen TUI output, dense redraws are hard to
read, and there is no persistent side pane for reviewing changed files.

Add a per-conversation split toggle in the native Claude terminal title bar. The
left pane remains the existing interactive PTY and bottom composer; the right pane
shows read-only changes from the conversation working directory. An unassigned
Claude session can open the pane too; non-Git directories show a clear empty state. The divider supports
bounded resizing. Closing the pane restores all width to the PTY. Persist the
choice and width only for this local conversation. Shell conversations keep the
same terminal behavior but do not gain the Claude-specific review pane.

The changes adapter resolves the conversation ID through the existing registry,
then invokes Git read-only commands in that record's `cwd`, without shell execution,
external diff drivers or text conversion. Bound filenames, output size and command
time. Unknown or non-Git directories show an explicit empty state. Selecting a file
shows a bounded patch; untracked files appear by name without reading their bytes.
Neither pane mutates code, Git state, terminal input or project identity.

Claude may request these local display actions from its own PTY by emitting an
OSC 777 `ccc-ui:` command to the controlling terminal. Only the current Claude
display handles `split=open|close|toggle|refresh` and `redraw`; shell sessions,
other conversations and replayed output cannot trigger commands. A short
session prompt documents the escape sequence for Claude's Bash tool. The tool
must write to `/dev/tty`, since captured Bash stdout is not the interactive PTY.
The command only changes the local display; it does not change files or send
terminal input. Existing resumed Claude sessions may need the user to tell
Claude about this command until Claude refreshes its system prompt.

On layout changes, fit the terminal and send only the final dimensions to the PTY.
Keep xterm inside its own clipped pane and preserve fullwidth glyph measurement. Do not replay or write partial commands merely to
recover a scrambled display; the user can explicitly reconnect the display.

## Recovery from a truncated Claude TUI replay (2026-09-28)

The old `redraw` control reconnected the display. When the bounded PTY output
history had been truncated, reconnect displayed only a reset notice and whatever
incremental cursor updates Claude emitted next; it could look like isolated
numbers and fragments. `redraw` must instead keep the current stream and
request a bounded PTY resize pulse from the terminal service, which restores
the recorded dimensions in all cases. A running Claude session automatically
requests the same pulse after a truncated replay has been parsed. The pulse
does not send a keystroke, restart Claude, discard input, or replay partial ANSI
history. It is limited to the active owned terminal and coalesces repeat requests.
Normal layout changes still send only their final dimensions.

Verify split open/close/resize, conversation isolation, safe Git reads, and terminal
input routing. Treat physical native rendering as a separate acceptance check.
