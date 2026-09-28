// Presentation-only mirror of a visible Claude CLI choice menu. The terminal
// remains authoritative; this never interprets text as an approval decision.
export function terminalChoicePrompt(buffer, rows = 24) {
  if (!buffer?.getLine || !Number.isInteger(buffer.length)) return null;
  const end = Math.min(buffer.length, Math.max(buffer.viewportY || 0, 0) + rows);
  const start = Math.max(0, end - 22);
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
    if (options.length && row - options.at(-1).row > 2) { options.length = 0; selected = -1; }
    const label = match[3].trim();
    if (!label) continue;
    if (match[1]) selected = options.length;
    options.push({ row, number: Number(match[2]), label });
  }
  if (options.length < 2 || options.length > 9 || selected < 0) return null;
  if (lines.length - options.at(-1).row > 8) return null;
  if (!options.every((item, index) => index === 0 || item.number === options[index - 1].number + 1)) return null;
  const before = lines.slice(Math.max(0, options[0].row - 5), options[0].row).map(line => line.trim()).filter(Boolean);
  const question = before.reverse().find(line => !/^[-─━\s]+$/u.test(line) && !/^\d+[.)]/u.test(line)) || '';
  if (!question || question.length > 200) return null;
  return { question, options: options.map(({ number, label }) => ({ number, label })), selected };
}
