import { randomBytes } from "node:crypto";
import { ZoteroCredentialStore } from "./zotero-credentials.mjs";
import { asHeader, collectionKey, integer, itemKey, validateCreateInput, validateUpdateInput, assertAllowedKeys, assertPlainObject, optionalText, text } from "./zotero-write-validation.mjs";
import { ZOTERO_USER_LIBRARY_PREFIX, collectionPath, invalidError, itemPath, jsonBody, networkError, pickEditableData, writeError } from "./zotero-local-contract.mjs";

export const DEFAULT_ZOTERO_LOCAL_API_ORIGIN = "http://127.0.0.1:23119/api/";
export const ZOTERO_LOCAL_API_APP_NAME = "Codex Control Console";
export { ZOTERO_USER_LIBRARY_PREFIX };
export const ZOTERO_WRITE_BODY_LIMIT = 256 * 1024;

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

export { EDITABLE_FIELDS, CREATE_ITEM_TYPES } from "./zotero-write-validation.mjs";
