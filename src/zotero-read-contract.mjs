const SOURCE_LABEL = "本机 Zotero";
const SOURCE_TYPE = "local-zotero-sqlite";

export function asText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

export function escapeLikeTerm(value, limit = 200) {
  return asText(value).slice(0, limit).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function extractYear(value) {
  const match = asText(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

export function creatorName(row) {
  const firstName = asText(row.firstName);
  const lastName = asText(row.lastName);
  if (Number(row.fieldMode) === 1 || !firstName) return lastName || firstName;
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function collectionTreeOrder(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map();
  for (const row of rows) {
    const parentId = row.parentCollectionId && byId.has(row.parentCollectionId) ? row.parentCollectionId : null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(row);
  }
  const compare = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  for (const list of children.values()) list.sort((left, right) => compare.compare(left.name, right.name) || left.id - right.id);
  const output = [];
  const visited = new Set();
  const visit = (row, depth) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    output.push({ ...row, depth });
    for (const child of children.get(row.id) || []) visit(child, depth + 1);
  };
  for (const row of children.get(null) || []) visit(row, 0);
  for (const row of rows) visit(row, 0);
  return output;
}

export function responseBase(status, message = "") {
  const response = { status, source: SOURCE_LABEL, sourceType: SOURCE_TYPE, readOnly: true };
  if (message) response.message = message;
  return response;
}

export function publicReadError(error) {
  const code = error?.code || "";
  if (["ENOENT", "SQLITE_CANTOPEN", "ERR_SQLITE_CANTOPEN"].includes(code)) return "未找到本机 Zotero 数据库。请确认 Zotero 已安装，或配置 CODEX_CONTROL_ZOTERO_PATH。";
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || /busy|locked/i.test(error?.message || "")) return "Zotero 数据库暂时被占用，请稍后刷新。";
  if (/readonly|read-only/i.test(error?.message || "")) return "Zotero 数据库无法以只读方式打开。控制台没有继续读取。";
  return "无法读取本机 Zotero 数据库。控制台没有伪造文献数据。";
}

export function countPayload(row) {
  return {
    items: asNumber(row.items), itemRows: asNumber(row.itemRows), collections: asNumber(row.collections),
    attachments: asNumber(row.attachments), notes: asNumber(row.notes), libraries: asNumber(row.libraries), deletedItems: asNumber(row.deletedItems)
  };
}

export function mapItemRow(row) {
  const itemType = asText(row.itemType) || "unknown";
  return {
    id: asNumber(row.id), itemId: asNumber(row.itemId), key: asText(row.key), zoteroKey: asText(row.key), libraryId: asNumber(row.libraryId),
    title: asText(row.title) || "未命名条目", creators: [], creatorText: "", year: extractYear(row.date), date: asText(row.date),
    itemType, type: itemType, publication: asText(row.publication), tags: [], collections: [], collectionKeys: [], collectionNames: [],
    noteCount: 0, attachmentCount: 0, notes: 0, attachments: 0, dateAdded: asText(row.dateAdded), updatedAt: asText(row.updatedAt)
  };
}
