// Presentation-only mirror of a visible Claude CLI choice menu. The terminal
// remains authoritative; this never interprets text as an approval decision.
export function terminalChoicePrompt(buffer, rows = 24) {
  if (!buffer?.getLine || !Number.isInteger(buffer.length)) return null;
  const end = Math.min(buffer.length, Math.max(buffer.viewportY || 0, 0) + rows);
  const start = Math.max(0, end - Math.min(rows, 60));
  const lines = [];
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row)?.translateToString?.(true);
    if (typeof line === 'string') lines.push(line.trimEnd());
  }
  const options = [];
  let selected = -1;
  for (let row = 0; row < lines.length; row++) {
    const match = lines[row].match(/^\s*([❯›>]?)\s*(\d{1,2})[.)]\s+(.{1,180})$/u);
    if (!match) continue;
    // Claude may put a multi-line terminal illustration under each choice.
    if (options.length && row - options.at(-1).row > 14) { options.length = 0; selected = -1; }
    const label = match[3].trim();
    if (!label) continue;
    if (match[1]) selected = options.length;
    options.push({ row, number: Number(match[2]), label });
  }
  if (options.length < 2 || options.length > 9 || selected < 0) return null;
  if (lines.length - options.at(-1).row > 12) return null;
  if (!options.every((item, index) => index === 0 || item.number === options[index - 1].number + 1)) return null;
  const art = line => /[\u2500-\u257f\u2580-\u259f]/u.test(line)
    || /^\s*(?:\+[-+=]{3,}\+|\|.{3,}\||[-=_]{6,})/u.test(line);
  const before = lines.slice(Math.max(0, options[0].row - 20), options[0].row)
    .map((line, index) => ({ line: line.trim(), row: Math.max(0, options[0].row - 20) + index }))
    .filter(item => item.line && !art(item.line) && !/^\d+[.)]/u.test(item.line));
  const title = before.toReversed().find(item => /[?？:：]$/u.test(item.line)) || before.at(-1);
  const question = title?.line || '';
  if (!question || question.length > 200) return null;
  const previewLines = lines.slice(Math.max(title.row, options.at(-1).row - 29), Math.min(lines.length, options.at(-1).row + 5));
  const preview = previewLines.some(art) ? previewLines.join('\n').slice(0, 8192) : '';
  return { question, options: options.map(({ number, label }) => ({ number, label })), selected, preview };
}
