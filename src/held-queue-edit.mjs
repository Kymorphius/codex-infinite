export function readHeldEditableText(input) {
  if (!Array.isArray(input)) return null;
  const textParts = input.filter((part) => (
    part && typeof part === "object" && part.type === "text" && typeof part.text === "string"
  ));
  return textParts.length === 1 ? textParts[0].text : null;
}

export function replaceHeldEditableText(input, value) {
  const text = String(value ?? "").trim();
  if (!text || readHeldEditableText(input) == null) return null;
  let replaced = false;
  return input.map((part) => {
    if (replaced || !part || typeof part !== "object" || part.type !== "text" || typeof part.text !== "string") return part;
    replaced = true;
    const next = { ...part, text };
    if (Object.hasOwn(next, "text_elements")) next.text_elements = [];
    return next;
  });
}
