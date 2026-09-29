// Whether a PTY's interactive input line may hold text nobody submitted yet, judged only from the
// input frames written to it. Conservative by design: unknown means dirty. The line becomes clean
// only on a submit (a bare Enter, or ⌘Enter's Ctrl-X Ctrl-S) or Ctrl-C (which clears Claude's
// prompt). Enters that only edit keep it dirty: after a backslash (line continuation), after ESC
// (Option/Meta+Enter, also split across frames), inside a bracketed paste, and while the last word
// is an @mention (Enter accepts the file suggestion). Any other byte (typing, a paste without Enter,
// arrows recalling history, Esc) makes it dirty. `seq` counts input frames, so a caller can tell
// whether anything arrived since it looked.
export const cleanTerminalInputLine = () => ({ dirty: false, at: 0, seq: 0, text: '', last: '', paste: false });

// Bytes the terminal emulator sends on its own (focus and mouse reports, replies to queries such
// as DA1/DA2, cursor position, DECRPM, kitty keyboard flags, OSC colors) never edit the line.
const REPORTS = /\x1b\[[IO]|\x1b\[<[\d;]*[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[>=]?[\d;]*[Rcn]|\x1b\[\?[\d;]*[Rcnu]|\x1b\[\??[\d;]*\$y|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\/gu;
const PASTE = /\x1b\[20([01])~/y, SEQUENCE = /\x1b(?:\[[\d;?<>=]*[\x20-\x2f]*[\x40-\x7e]|O[\s\S])/y;
const MENTION = /(?:^|\s)@\S*$/u;

export function terminalInputLine(previous, data, at) {
  const input = typeof data === 'string' ? data.replace(REPORTS, '') : '';
  if (!input) return previous || cleanTerminalInputLine();
  const state = { ...cleanTerminalInputLine(), ...previous };
  let { dirty, text, last, paste } = state;
  const edit = char => { dirty = true; text = (text + char).slice(-256); last = char; };
  const clean = () => { dirty = false; text = ''; last = ''; };
  for (let index = 0; index < input.length;) {
    const char = input[index];
    PASTE.lastIndex = index; const marker = PASTE.exec(input);
    if (marker) { paste = marker[1] === '0'; dirty = true; index = PASTE.lastIndex; continue; }
    if (paste) { edit(char === '\r' ? '\n' : char); index++; continue; }
    if (char === '\x1b') {
      if (input[index + 1] === '\r') { edit('\n'); index += 2; continue; }
      SEQUENCE.lastIndex = index; const sequence = SEQUENCE.exec(input);
      // A key sequence (arrows, Delete, Alt+key) edits somewhere unknown; a bare ESC may pair with a later Enter.
      dirty = true; last = sequence ? '' : input[index + 1] ? '' : '\x1b';
      index = sequence ? SEQUENCE.lastIndex : index + (input[index + 1] ? 2 : 1); continue;
    }
    if (char === '\r') {
      if (last === '\\') { text = text.slice(0, -1) + '\n'; dirty = true; last = '\n'; }
      else if (last === '\x1b') edit('\n');
      else if (MENTION.test(text)) edit(' ');
      else clean();
    } else if (char === '\x03' || (char === '\x18' && input[index + 1] === '\x13')) { clean(); if (char === '\x18') index++; }
    else if (char === '\x7f' || char === '\b') { dirty = true; text = text.slice(0, -1); last = text.at(-1) || ''; }
    else edit(char);
    index++;
  }
  return { dirty, at, seq: state.seq + 1, text, last, paste };
}

// What callers outside the tracker see.
export const terminalInputLineView = line => ({ dirty: line.dirty, at: line.at, seq: line.seq });
