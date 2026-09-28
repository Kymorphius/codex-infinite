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

On layout changes, fit the terminal and send only the final dimensions to the PTY.
Keep xterm inside its own clipped pane and preserve fullwidth glyph measurement. Do not replay or write partial commands merely to
recover a scrambled display; the user can explicitly reconnect the display.

Verify split open/close/resize, conversation isolation, safe Git reads, and terminal
input routing. Treat physical native rendering as a separate acceptance check.
