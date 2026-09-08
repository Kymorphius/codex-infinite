function blockStart(line) {
  return /^\s*```/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*>\s?/.test(line)
    || /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

export function parseMarkdownBlocks(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index += 1; continue; }
    const fence = lines[index].match(/^\s*```([^`]*)$/);
    if (fence) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1].trim(), text: content.join("\n") });
      continue;
    }
    const heading = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); index += 1; continue; }
    if (/^\s*>\s?/.test(lines[index])) {
      const content = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) content.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: content.join("\n") });
      continue;
    }
    const list = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]); index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const content = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !blockStart(lines[index])) content.push(lines[index++]);
    blocks.push({ type: "paragraph", text: content.join("\n") });
  }
  return blocks;
}

export function inlineMarkdownTokens(value) {
  const text = String(value || "");
  const pattern = /(`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))/g;
  const tokens = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ type: "text", text: text.slice(cursor, match.index) });
    if (match[2] != null) tokens.push({ type: "code", text: match[2] });
    else if (match[3] != null) tokens.push({ type: "strong", text: match[3] });
    else if (match[4] != null) tokens.push({ type: "emphasis", text: match[4] });
    else tokens.push({ type: "link", text: match[5], href: match[6] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
  return tokens;
}

function appendInline(element, value, documentRef) {
  inlineMarkdownTokens(value).forEach((token) => {
    if (token.type === "text") { element.append(documentRef.createTextNode(token.text)); return; }
    const tag = token.type === "code" ? "code" : token.type === "strong" ? "strong" : token.type === "emphasis" ? "em" : "a";
    const child = documentRef.createElement(tag);
    child.textContent = token.text;
    if (token.type === "link") { child.href = token.href; child.target = "_blank"; child.rel = "noreferrer noopener"; }
    element.append(child);
  });
}

function appendTextBlock(element, value, documentRef) {
  String(value).split("\n").forEach((line, index) => {
    if (index) element.append(documentRef.createElement("br"));
    appendInline(element, line, documentRef);
  });
}

export function renderMarkdown(value, { documentRef = document } = {}) {
  const root = documentRef.createElement("div");
  root.className = "conversation-markdown";
  parseMarkdownBlocks(value).forEach((block) => {
    if (block.type === "code") {
      const pre = documentRef.createElement("pre"), code = documentRef.createElement("code");
      if (block.language) code.dataset.language = block.language;
      code.textContent = block.text; pre.append(code); root.append(pre); return;
    }
    if (block.type === "list") {
      const list = documentRef.createElement(block.ordered ? "ol" : "ul");
      block.items.forEach((item) => { const row = documentRef.createElement("li"); appendInline(row, item, documentRef); list.append(row); });
      root.append(list); return;
    }
    const tag = block.type === "heading" ? `h${block.level}` : block.type === "quote" ? "blockquote" : "p";
    const element = documentRef.createElement(tag);
    appendTextBlock(element, block.text, documentRef); root.append(element);
  });
  return root;
}
