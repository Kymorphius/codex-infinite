import { randomBytes } from "node:crypto";
import { ZoteroCredentialStore } from "./zotero-credentials.mjs";

export const DEFAULT_ZOTERO_LOCAL_API_ORIGIN = "http://127.0.0.1:23119/api/";
export const ZOTERO_LOCAL_API_APP_NAME = "Codex Control Console";
export const ZOTERO_USER_LIBRARY_PREFIX = "users/0";
export const ZOTERO_WRITE_BODY_LIMIT = 256 * 1024;

const EDITABLE_FIELDS = ["title", "abstractNote", "date", "url", "DOI", "ISBN", "publicationTitle"];
const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
const CREATE_ITEM_TYPES = new Set(["book", "journalArticle", "webpage"]);
const LIST_FIELDS = ["creators", "tags", "collections"];
const LIST_FIELD_SET = new Set(LIST_FIELDS);
const ROOT_UPDATE_FIELDS = new Set(["version", "fields", "creators", "tags", "collections", "completeLists"]);
const ROOT_CREATE_FIELDS = new Set(["itemType", "fields", "creators", "tags", "collections"]);

function asHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : "";
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function text(value, maximum = 20000) {
  if (typeof value !== "string") throw new Error("文本字段必须是字符串");
  const result = value.trim();
  if (result.length > maximum) throw new Error("文本字段过长");
  return result;
}

function optionalText(value, maximum = 20000) {
  if (value === undefined || value === null) return "";
  return text(value, maximum);
}

function assertPlainObject(value, message = "请求格式无效") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function assertAllowedKeys(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error("请求包含不支持的字段");
}

function itemKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Zotero 条目标识无效");
  return value;
}

function collectionKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Zotero 集合标识无效");
  return value;
}

function validateFields(value, { required = false } = {}) {
  if (value === undefined && !required) return {};
  const fields = assertPlainObject(value, "文献字段格式无效");
  assertAllowedKeys(fields, EDITABLE_FIELD_SET);
  const output = {};
  for (const [key, fieldValue] of Object.entries(fields)) output[key] = text(fieldValue, key === "abstractNote" ? 50000 : 4000);
  return output;
}

function validateCreator(value) {
  const creator = assertPlainObject(value, "作者格式无效");
  assertAllowedKeys(creator, new Set(["creatorType", "firstName", "lastName", "name"]));
  const creatorType = text(creator.creatorType || "author", 80);
  const firstName = optionalText(creator.firstName, 500);
  const lastName = optionalText(creator.lastName, 500);
  const name = optionalText(creator.name, 1000);
  if (!name && !firstName && !lastName) throw new Error("作者不能为空");
  const output = { creatorType };
  if (name) output.name = name;
  else {
    if (firstName) output.firstName = firstName;
    if (lastName) output.lastName = lastName;
  }
  return output;
}

function validateCreators(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("作者完整列表格式无效");
  return value.map(validateCreator);
}

function validateTag(value) {
  const tag = assertPlainObject(value, "标签格式无效");
  assertAllowedKeys(tag, new Set(["tag", "type"]));
  const output = { tag: text(tag.tag, 500) };
  if (tag.type !== undefined) {
    const type = integer(tag.type);
    if (type === null || type > 100) throw new Error("标签类型无效");
    output.type = type;
  }
  return output;
}

function validateTags(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 500) throw new Error("标签完整列表格式无效");
  return value.map(validateTag);
}

function validateCollections(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("集合完整列表格式无效");
  return value.map(collectionKey);
}

function validateCompleteLists(value, body) {
  if (!Array.isArray(value)) throw new Error("完整列表确认缺失");
  const names = [...new Set(value)];
  if (names.some((name) => !LIST_FIELD_SET.has(name))) throw new Error("完整列表字段无效");
  for (const name of names) if (!Object.hasOwn(body, name)) throw new Error("完整列表必须显式提交");
  return names;
}

export function validateUpdateInput(input) {
  const body = assertPlainObject(input);
  assertAllowedKeys(body, ROOT_UPDATE_FIELDS);
  const version = integer(body.version);
  if (version === null) throw new Error("文献版本号缺失");
  const fields = validateFields(body.fields);
  const completeLists = validateCompleteLists(body.completeLists, body);
  const creators = completeLists.includes("creators") ? validateCreators(body.creators, { required: true }) : undefined;
  const tags = completeLists.includes("tags") ? validateTags(body.tags, { required: true }) : undefined;
  const collections = completeLists.includes("collections") ? validateCollections(body.collections, { required: true }) : undefined;
  return { version, fields, creators, tags, collections, completeLists };
}

export function validateCreateInput(input) {
  const body = assertPlainObject(input);
  assertAllowedKeys(body, ROOT_CREATE_FIELDS);
  const itemType = text(body.itemType, 80);
  if (!CREATE_ITEM_TYPES.has(itemType)) throw new Error("当前只支持书籍、期刊文章或网页条目");
  const fields = validateFields(body.fields, { required: true });
  const creators = validateCreators(body.creators, { required: true });
  const tags = validateTags(body.tags, { required: true });
  const collections = validateCollections(body.collections, { required: true });
  return { itemType, fields, creators, tags, collections };
}

function itemPath(key) {
  return `${ZOTERO_USER_LIBRARY_PREFIX}/items/${encodeURIComponent(itemKey(key))}`;
}

function collectionPath(key = "") {
  return key ? `${ZOTERO_USER_LIBRARY_PREFIX}/collections/${encodeURIComponent(collectionKey(key))}` : `${ZOTERO_USER_LIBRARY_PREFIX}/collections`;
}

function writeError(status, message, extras = {}) {
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

function offlineError() {
  return {
    status: "offline",
    connected: false,
    authorization: "unavailable",
    message: "Zotero 当前未运行。请启动 Zotero 后再连接回写。",
    httpStatus: 503
  };
}

function networkError() {
  return offlineError();
}

function invalidError(message) {
  return { status: "invalid", message: message || "请求格式无效。", httpStatus: 400 };
}

function pickEditableData(data, fallbackKey, fallbackVersion) {
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

async function jsonBody(response) {
  try { return await response.json(); } catch { return null; }
}

export class ZoteroLocalApi {
  constructor({
    baseUrl = DEFAULT_ZOTERO_LOCAL_API_ORIGIN,
    credentialStore,
    credentialFilePath,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    logger = null
  } = {}) {
    const parsed = new URL(baseUrl);
    if (parsed.hostname !== "127.0.0.1") throw new Error("Zotero Local API must use 127.0.0.1");
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Zotero Local API uses an unsupported protocol");
    parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    this.baseUrl = parsed;
    this.credentials = credentialStore || new ZoteroCredentialStore({ filePath: credentialFilePath });
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.serverInfo = null;
    this.authorizationState = "unknown";
  }

  _url(pathname) {
    return new URL(pathname, this.baseUrl).toString();
  }

  async _request(pathname, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this._url(pathname), { ...options, signal: options.signal || controller.signal });
      return { response };
    } catch (error) {
      // Do not pass the native error message through: fetch errors can contain
      // URLs, and Local API credentials must never enter diagnostics.
      if (this.logger?.debug) this.logger.debug("Zotero Local API unavailable");
      return { response: null, error };
    } finally {
      clearTimeout(timer);
    }
  }

  async discover() {
    const { response } = await this._request("");
    if (!response) return networkError();
    if (!response.ok) return writeError(response.status);
    const serverId = asHeader(response.headers, "Zotero-Server-ID");
    if (!serverId) return { status: "error", connected: false, message: "Zotero Local API 未返回服务器标识。", httpStatus: 502 };
    this.serverInfo = {
      serverId,
      apiVersion: asHeader(response.headers, "Zotero-API-Version") || "",
      schemaVersion: asHeader(response.headers, "Zotero-Schema-Version") || ""
    };
    return { status: "connected", connected: true, ...this.serverInfo, httpStatus: 200 };
  }

  async _key(serverId) {
    return this.credentials.get(serverId);
  }

  async _writeContext() {
    const discovery = await this.discover();
    if (discovery.status !== "connected") return { error: discovery };
    const credential = await this._key(discovery.serverId);
    if (!credential?.key) {
      this.authorizationState = "required";
      return { error: { status: "unauthorized", authorization: "required", message: "请先连接 Zotero 回写授权。", httpStatus: 401 }, discovery };
    }
    return { discovery, credential };
  }

  async getWriteStatus() {
    const discovery = await this.discover();
    if (discovery.status !== "connected") return {
      source: "Zotero Local API",
      localApi: "offline",
      ...discovery,
      remembered: typeof this.credentials.hasAnyRemembered === "function" ? await this.credentials.hasAnyRemembered() : false,
      readOnlyAvailable: true,
      writeEnabled: false
    };
    const credential = await this._key(discovery.serverId);
    const authorization = credential?.key ? "authorized" : (this.authorizationState === "denied" ? "denied" : "required");
    return {
      status: "connected",
      source: "Zotero Local API",
      localApi: "connected",
      connected: true,
      authorization,
      state: authorization,
      remembered: Boolean(credential?.remembered),
      writeEnabled: Boolean(credential?.key),
      serverId: discovery.serverId,
      apiVersion: discovery.apiVersion,
      readOnlyAvailable: true,
      message: authorization === "authorized" ? "Zotero 回写已连接。" : "Zotero 在线，但需要用户确认回写授权。",
      httpStatus: 200
    };
  }

  async authorize() {
    const discovery = await this.discover();
    if (discovery.status !== "connected") return discovery;
    const { response } = await this._request("local/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Zotero-Server-ID": discovery.serverId },
      body: JSON.stringify({ appName: ZOTERO_LOCAL_API_APP_NAME })
    });
    if (!response) return networkError();
    if (!response.ok) {
      const result = writeError(response.status);
      if (response.status === 403) this.authorizationState = "denied";
      if (response.status === 429) result.retryAfter = asHeader(response.headers, "Retry-After") || undefined;
      return result;
    }
    const body = await jsonBody(response);
    const key = typeof body?.key === "string" ? body.key : "";
    if (!key) return { status: "error", message: "Zotero 未返回有效授权结果。", httpStatus: 502 };
    const remember = body.remember === true;
    await this.credentials.save(discovery.serverId, key, { remember });
    this.authorizationState = "authorized";
    return {
      status: "authorized",
      authorization: "authorized",
      remembered: remember,
      serverId: discovery.serverId,
      message: remember ? "Zotero 回写已连接，并已记住授权。" : "Zotero 回写已连接；本次授权将在一次成功写入后失效。",
      httpStatus: 200
    };
  }

  async forgetAuthorization() {
    const serverId = this.serverInfo?.serverId;
    if (serverId) await this.credentials.forget(serverId);
    else if (this.credentials.forgetAll) await this.credentials.forgetAll();
    this.authorizationState = "required";
    return { status: "forgot", authorization: "required", message: "已忘记 Codex 保存的 Zotero 回写授权。", httpStatus: 200 };
  }

  async getEditableItem(key) {
    let validKey;
    try { validKey = itemKey(key); } catch (error) { return invalidError(error.message); }
    const discovery = await this.discover();
    if (discovery.status !== "connected") return discovery;
    const { response } = await this._request(itemPath(validKey), { headers: { "Zotero-Server-ID": discovery.serverId } });
    if (!response) return networkError();
    if (!response.ok) return writeError(response.status);
    const body = await jsonBody(response);
    const source = body?.data || body?.item?.data || body || {};
    const item = pickEditableData(source, validKey, body?.version ?? asHeader(response.headers, "Last-Modified-Version"));
    if (item.version === null) return { status: "error", message: "Zotero 条目缺少版本信息，已停止编辑。", httpStatus: 502 };
    return { status: "ok", item, version: item.version, httpStatus: 200 };
  }

  async _finishWrite(serverId, credential) {
    if (credential?.oneTime) await this.credentials.consumeOneTime(serverId);
  }

  async updateItem(key, input) {
    let validKey;
    let change;
    try {
      validKey = itemKey(key);
      change = validateUpdateInput(input);
    } catch (error) {
      return invalidError(error.message);
    }
    const latest = await this.getEditableItem(validKey);
    if (latest.status !== "ok") return latest;
    if (latest.version !== change.version) {
      return writeError(412, undefined, { expectedVersion: change.version, actualVersion: latest.version, item: latest.item });
    }
    const context = await this._writeContext();
    if (context.error) return context.error;
    const { discovery, credential } = context;
    const payload = { ...change.fields };
    if (change.completeLists.includes("creators")) payload.creators = change.creators;
    if (change.completeLists.includes("tags")) payload.tags = change.tags;
    if (change.completeLists.includes("collections")) payload.collections = change.collections;
    const { response } = await this._request(itemPath(validKey), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Zotero-API-Key": credential.key,
        "Zotero-Server-ID": discovery.serverId,
        "If-Unmodified-Since-Version": String(latest.version)
      },
      body: JSON.stringify(payload)
    });
    if (!response) return networkError();
    if (!response.ok) {
      const result = writeError(response.status);
      if (response.status === 401) {
        await this.credentials.forget(discovery.serverId);
        this.authorizationState = "required";
      }
      return result;
    }
    await this._finishWrite(discovery.serverId, credential);
    this.authorizationState = "authorized";
    const body = await jsonBody(response);
    const version = integer(body?.version) ?? integer(asHeader(response.headers, "Last-Modified-Version")) ?? latest.version + 1;
    return { status: "updated", key: validKey, version, message: `文献已更新，当前版本 ${version}。`, httpStatus: 200 };
  }

  async createItem(input) {
    let item;
    try { item = validateCreateInput(input); } catch (error) { return invalidError(error.message); }
    const context = await this._writeContext();
    if (context.error) return context.error;
    const { discovery, credential } = context;
    const payload = {
      itemType: item.itemType,
      ...item.fields,
      creators: item.creators,
      tags: item.tags,
      collections: item.collections
    };
    const { response } = await this._request(`${ZOTERO_USER_LIBRARY_PREFIX}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Zotero-API-Key": credential.key,
        "Zotero-Server-ID": discovery.serverId,
        "Zotero-Write-Token": randomBytes(16).toString("hex")
      },
      body: JSON.stringify([payload])
    });
    if (!response) return networkError();
    if (!response.ok) {
      const result = writeError(response.status);
      if (response.status === 401) {
        await this.credentials.forget(discovery.serverId);
        this.authorizationState = "required";
      }
      return result;
    }
    await this._finishWrite(discovery.serverId, credential);
    const body = await jsonBody(response);
    const createdKey = body?.success?.["0"] || body?.success?.[0] || body?.key || "";
    return { status: "created", key: typeof createdKey === "string" ? createdKey : "", message: "新文献已创建。", httpStatus: 201 };
  }

  async addNote(parentKey, input) {
    let validParent;
    let note;
    try {
      validParent = itemKey(parentKey);
      const body = assertPlainObject(input);
      assertAllowedKeys(body, new Set(["note", "title"]));
      note = { note: text(body.note, 100000), title: optionalText(body.title, 500) };
      if (!note.note) throw new Error("笔记内容不能为空");
    } catch (error) {
      return invalidError(error.message);
    }
    const parent = await this.getEditableItem(validParent);
    if (parent.status !== "ok") return parent;
    const context = await this._writeContext();
    if (context.error) return context.error;
    const { discovery, credential } = context;
    const { response } = await this._request(`${ZOTERO_USER_LIBRARY_PREFIX}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Zotero-API-Key": credential.key,
        "Zotero-Server-ID": discovery.serverId,
        "Zotero-Write-Token": randomBytes(16).toString("hex")
      },
      body: JSON.stringify([{ itemType: "note", parentItem: validParent, ...note }])
    });
    if (!response) return networkError();
    if (!response.ok) {
      const result = writeError(response.status);
      if (response.status === 401) {
        await this.credentials.forget(discovery.serverId);
        this.authorizationState = "required";
      }
      return result;
    }
    await this._finishWrite(discovery.serverId, credential);
    const body = await jsonBody(response);
    const createdKey = body?.success?.["0"] || body?.success?.[0] || body?.key || "";
    return { status: "note_created", key: typeof createdKey === "string" ? createdKey : "", parentKey: validParent, message: "子笔记已添加。", httpStatus: 201 };
  }

  async createCollection(input) {
    let collection;
    try {
      const body = assertPlainObject(input);
      assertAllowedKeys(body, new Set(["name", "parentCollection"]));
      collection = { name: text(body.name, 500) };
      if (!collection.name) throw new Error("集合名称不能为空");
      if (body.parentCollection) collection.parentCollection = collectionKey(body.parentCollection);
    } catch (error) {
      return invalidError(error.message);
    }
    const context = await this._writeContext();
    if (context.error) return context.error;
    const { discovery, credential } = context;
    const { response } = await this._request(collectionPath(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Zotero-API-Key": credential.key,
        "Zotero-Server-ID": discovery.serverId,
        "Zotero-Write-Token": randomBytes(16).toString("hex")
      },
      body: JSON.stringify([collection])
    });
    if (!response) return networkError();
    if (!response.ok) {
      const result = writeError(response.status);
      if (response.status === 401) {
        await this.credentials.forget(discovery.serverId);
        this.authorizationState = "required";
      }
      return result;
    }
    await this._finishWrite(discovery.serverId, credential);
    const body = await jsonBody(response);
    const createdKey = body?.success?.["0"] || body?.success?.[0] || body?.key || "";
    return { status: "collection_created", key: typeof createdKey === "string" ? createdKey : "", message: "集合已创建。", httpStatus: 201 };
  }
}

export { EDITABLE_FIELDS, CREATE_ITEM_TYPES };
