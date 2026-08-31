import { EDITABLE_FIELDS, asHeader, collectionKey, integer, itemKey } from "./zotero-write-validation.mjs";

export const ZOTERO_USER_LIBRARY_PREFIX = "users/0";

export function itemPath(key) {
  return `${ZOTERO_USER_LIBRARY_PREFIX}/items/${encodeURIComponent(itemKey(key))}`;
}

export function collectionPath(key = "") {
  return key ? `${ZOTERO_USER_LIBRARY_PREFIX}/collections/${encodeURIComponent(collectionKey(key))}` : `${ZOTERO_USER_LIBRARY_PREFIX}/collections`;
}

export function writeError(status, message, extras = {}) {
  const map = {
    401: { state: "unauthorized", authorization: "required", message: "需要重新连接 Zotero 回写授权。" },
    403: { state: "denied", authorization: "denied", message: "Zotero 拒绝了回写，或本地 API 回写已被禁用。" },
    409: { state: "locked", message: "Zotero 正在处理另一项写入，请稍后重试。" },
    412: { state: "conflict", message: "这条文献已被其他位置更新，请重新加载后再提交。" },
    428: { state: "precondition", message: "Zotero 要求版本前置条件；本次写入已停止。" },
    429: { state: "throttled", message: "Zotero 授权提示过于频繁，请稍后再试。" },
    404: { state: "not_found", message: "Zotero 中找不到这项内容。" }
  };
  const mapped = map[status] || { state: "error", message: "Zotero 本地 API 请求失败。" };
  return { status: mapped.state, authorization: mapped.authorization, message: mapped.message, httpStatus: status >= 400 ? status : 502, ...extras };
}

export function offlineError() {
  return {
    status: "offline",
    connected: false,
    authorization: "unavailable",
    message: "Zotero 当前未运行。请启动 Zotero 后再连接回写。",
    httpStatus: 503
  };
}

export function networkError() {
  return offlineError();
}

export function invalidError(message) {
  return { status: "invalid", message: message || "请求格式无效。", httpStatus: 400 };
}

export function pickEditableData(data, fallbackKey, fallbackVersion) {
  const source = data && typeof data === "object" ? data : {};
  const output = {};
  for (const field of EDITABLE_FIELDS) output[field] = typeof source[field] === "string" ? source[field] : "";
  const creators = Array.isArray(source.creators) ? source.creators.map((creator) => {
    const value = creator && typeof creator === "object" ? creator : {};
    const result = { creatorType: typeof value.creatorType === "string" ? value.creatorType : "author" };
    for (const field of ["firstName", "lastName", "name"]) if (typeof value[field] === "string" && value[field]) result[field] = value[field];
    return result;
  }) : [];
  const tags = Array.isArray(source.tags) ? source.tags.map((tag) => {
    if (typeof tag === "string") return { tag };
    return { tag: typeof tag?.tag === "string" ? tag.tag : "", ...(Number.isInteger(tag?.type) ? { type: tag.type } : {}) };
  }).filter((tag) => tag.tag) : [];
  const collections = Array.isArray(source.collections) ? source.collections.map((value) => typeof value === "string" ? value : value?.key).filter(Boolean) : [];
  const version = integer(source.version) ?? integer(fallbackVersion);
  return {
    key: typeof source.key === "string" ? source.key : fallbackKey,
    itemType: typeof source.itemType === "string" ? source.itemType : "",
    version,
    fields: output,
    creators,
    tags,
    collections
  };
}

export async function jsonBody(response) {
  try { return await response.json(); } catch { return null; }
}
