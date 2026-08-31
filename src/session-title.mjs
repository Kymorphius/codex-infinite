const TRANSPORT_BLOCKS = [
  "recommended_plugins",
  "environment_context",
  "in-app-browser-context",
  "permissions",
  "apps_instructions",
  "plugins_instructions",
  "skills_instructions"
];

function stripTransportBlocks(value) {
  let text = String(value || "");
  for (const tag of TRANSPORT_BLOCKS) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, "gi"), " ");
  }
  return text;
}

export function meaningfulSessionText(value) {
  let text = String(value || "");
  const requestMarker = text.match(/(?:^|\n)## My request:\s*/i);
  if (requestMarker) text = text.slice((requestMarker.index || 0) + requestMarker[0].length);
  text = stripTransportBlocks(text);
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function userTextFromSessionRecord(record) {
  const payload = record?.payload;
  if (record?.type === "event_msg" && payload?.type === "user_message") {
    return meaningfulSessionText(payload.message);
  }
  if (record?.type !== "response_item" || payload?.type !== "message" || payload?.role !== "user" || !Array.isArray(payload.content)) {
    return "";
  }
  return meaningfulSessionText(payload.content
    .filter((item) => item?.type === "input_text")
    .map((item) => item.text || "")
    .join("\n"));
}

export function boundedSessionTitle(value, fallback) {
  return (meaningfulSessionText(value) || String(fallback || "")).slice(0, 160);
}
