import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_ZOTERO_PATH = path.join(os.homedir(), "Zotero", "zotero.sqlite");
export const DEFAULT_ZOTERO_LIMIT = 24;
export const MAX_ZOTERO_LIMIT = 100;
export const MAX_ZOTERO_OFFSET = 1_000_000;

const SOURCE_LABEL = "本机 Zotero";
const SOURCE_TYPE = "local-zotero-sqlite";
const SPECIAL_ITEM_TYPES = ["note", "attachment", "annotation"];
const PUBLICATION_FIELDS = ["publicationTitle", "bookTitle", "conferenceName", "proceedingsTitle", "publisher"];
const SEARCH_LIMIT = 200;

function asText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function escapeLikeTerm(value) {
  return asText(value)
    .slice(0, SEARCH_LIMIT)
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function extractYear(value) {
  const match = asText(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function creatorName(row) {
  const firstName = asText(row.firstName);
  const lastName = asText(row.lastName);
  if (Number(row.fieldMode) === 1 || !firstName) return lastName || firstName;
  return [firstName, lastName].filter(Boolean).join(" ");
}

function collator() {
  return new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
}

function collectionTreeOrder(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map();
  for (const row of rows) {
    const parentId = row.parentCollectionId && byId.has(row.parentCollectionId) ? row.parentCollectionId : null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(row);
  }
  const compare = collator();
  for (const list of children.values()) {
    list.sort((left, right) => compare.compare(left.name, right.name) || left.id - right.id);
  }

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

function responseBase(status, message = "") {
  const response = {
    status,
    source: SOURCE_LABEL,
    sourceType: SOURCE_TYPE,
    readOnly: true
  };
  if (message) response.message = message;
  return response;
}

function errorMessage(error) {
  const code = error?.code || "";
  if (code === "ENOENT" || code === "SQLITE_CANTOPEN" || code === "ERR_SQLITE_CANTOPEN") {
    return "未找到本机 Zotero 数据库。请确认 Zotero 已安装，或配置 CODEX_CONTROL_ZOTERO_PATH。";
  }
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || /busy|locked/i.test(error?.message || "")) {
    return "Zotero 数据库暂时被占用，请稍后刷新。";
  }
  if (/readonly|read-only/i.test(error?.message || "")) {
    return "Zotero 数据库无法以只读方式打开。控制台没有继续读取。";
  }
  return "无法读取本机 Zotero 数据库。控制台没有伪造文献数据。";
}

function countPayload(row) {
  const counts = {
    items: asNumber(row.items),
    itemRows: asNumber(row.itemRows),
    collections: asNumber(row.collections),
    attachments: asNumber(row.attachments),
    notes: asNumber(row.notes),
    libraries: asNumber(row.libraries),
    deletedItems: asNumber(row.deletedItems)
  };
  return counts;
}

export class ZoteroAdapter {
  constructor({
    databasePath = DEFAULT_ZOTERO_PATH,
    databaseFactory = (filePath) => new DatabaseSync(filePath, { readOnly: true, timeout: 2500 }),
    logger = console
  } = {}) {
    this.databasePath = path.resolve(databasePath);
    this.databaseFactory = databaseFactory;
    this.logger = logger;
    this.database = null;
    this.tables = null;
  }

  _open() {
    if (this.database) return this.database;
    const database = this.databaseFactory(this.databasePath, { readOnly: true });
    // readOnly is enforced at sqlite3_open_v2 level. query_only adds a second
    // connection-level guard so accidental future writes fail closed as well.
    database.exec("PRAGMA query_only = ON");
    const queryOnly = database.prepare("PRAGMA query_only").get();
    if (Number(queryOnly?.query_only) !== 1) {
      database.close();
      throw new Error("SQLite query_only guard could not be enabled");
    }
    this.database = database;
    this.tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((row) => String(row.name)));
    return database;
  }

  _discardDatabase() {
    const database = this.database;
    this.database = null;
    this.tables = null;
    try {
      database?.close();
    } catch {
      // The original read error is more useful to the caller than a close error.
    }
  }

  _hasTable(name) {
    return this.tables?.has(name) === true;
  }

  _requireTables(names) {
    const missing = names.filter((name) => !this._hasTable(name));
    if (missing.length) throw new Error(`Zotero schema is missing required tables: ${missing.join(", ")}`);
  }

  _fieldsTable() {
    if (this._hasTable("fieldsCombined")) return "fieldsCombined";
    if (this._hasTable("fields")) return "fields";
    throw new Error("Zotero schema is missing a fields table");
  }

  _deletedItemCondition(alias = "i") {
    return this._hasTable("deletedItems") ? `NOT EXISTS (SELECT 1 FROM deletedItems di WHERE di.itemID = ${alias}.itemID)` : "1 = 1";
  }

  _baseItemCondition(alias = "i", typeAlias = "it") {
    const specialTypes = SPECIAL_ITEM_TYPES.map((type) => `'${type}'`).join(", ");
    return `${typeAlias}.typeName NOT IN (${specialTypes}) AND ${this._deletedItemCondition(alias)}`;
  }

  _disconnected(error) {
    this._discardDatabase();
    return {
      ...responseBase("disconnected", errorMessage(error)),
      counts: { items: 0, itemRows: 0, collections: 0, attachments: 0, notes: 0, libraries: 0, deletedItems: 0 }
    };
  }

  getStatus() {
    try {
      const database = this._open();
      this._requireTables(["items", "itemTypes", "collections", "libraries"]);
      const row = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM items) AS itemRows,
          (SELECT COUNT(*) FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID WHERE ${this._baseItemCondition()}) AS items,
          (SELECT COUNT(*) FROM collections) AS collections,
          (SELECT COUNT(*) FROM itemAttachments) AS attachments,
          (SELECT COUNT(*) FROM itemNotes) AS notes,
          (SELECT COUNT(*) FROM libraries WHERE archived = 0) AS libraries,
          (SELECT COUNT(*) FROM deletedItems) AS deletedItems
      `).get();
      const counts = countPayload(row);
      const status = counts.items > 0 ? "connected" : "empty";
      return {
        ...responseBase(status, status === "empty" ? "Zotero 已连接，但当前没有可显示的文献。" : ""),
        counts,
        // These aliases keep the response easy to consume for small clients.
        itemCount: counts.items,
        collectionCount: counts.collections
      };
    } catch (error) {
      this.logger.warn?.(`[codex-control-console] Zotero status unavailable: ${error.message}`);
      return this._disconnected(error);
    }
  }

  getCollections() {
    try {
      const database = this._open();
      this._requireTables(["collections", "collectionItems", "items", "itemTypes"]);
      const rows = database.prepare(`
        SELECT
          c.collectionID AS id,
          c.collectionID AS collectionId,
          c.collectionName AS name,
          c.collectionName AS collectionName,
          c.parentCollectionID AS parentCollectionId,
          c.libraryID AS libraryId,
          c.key AS key,
          (
            SELECT COUNT(DISTINCT ci.itemID)
            FROM collectionItems ci
            JOIN items i ON i.itemID = ci.itemID
            JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
            WHERE ci.collectionID = c.collectionID
              AND ${this._baseItemCondition("i", "it")}
          ) AS itemCount
        FROM collections c
      `).all();
      const collections = collectionTreeOrder(rows.map((row) => ({
        id: asNumber(row.id),
        collectionId: asNumber(row.collectionId),
        name: asText(row.name) || "未命名集合",
        collectionName: asText(row.collectionName) || "未命名集合",
        parentCollectionId: row.parentCollectionId === null ? null : asNumber(row.parentCollectionId),
        libraryId: asNumber(row.libraryId),
        key: asText(row.key),
        itemCount: asNumber(row.itemCount)
      })));
      return {
        ...responseBase(collections.length ? "connected" : "empty", collections.length ? "" : "Zotero 已连接，但当前没有集合。"),
        collections,
        count: collections.length
      };
    } catch (error) {
      this.logger.warn?.(`[codex-control-console] Zotero collections unavailable: ${error.message}`);
      return { ...this._disconnected(error), collections: [], count: 0 };
    }
  }

  _fieldValuesCte() {
    const fieldsTable = this._fieldsTable();
    return `
      WITH field_values AS (
        SELECT
          d.itemID,
          MAX(CASE WHEN f.fieldName = 'title' THEN v.value END) AS title,
          MAX(CASE WHEN f.fieldName = 'date' THEN v.value END) AS date,
          MAX(CASE WHEN f.fieldName = 'year' THEN v.value END) AS year,
          MAX(CASE WHEN f.fieldName = 'publicationTitle' THEN v.value END) AS publicationTitle,
          MAX(CASE WHEN f.fieldName = 'bookTitle' THEN v.value END) AS bookTitle,
          MAX(CASE WHEN f.fieldName = 'conferenceName' THEN v.value END) AS conferenceName,
          MAX(CASE WHEN f.fieldName = 'proceedingsTitle' THEN v.value END) AS proceedingsTitle,
          MAX(CASE WHEN f.fieldName = 'publisher' THEN v.value END) AS publisher
        FROM itemData d
        JOIN ${fieldsTable} f ON f.fieldID = d.fieldID
        JOIN itemDataValues v ON v.valueID = d.valueID
        GROUP BY d.itemID
      )
    `;
  }

  _searchCondition(query, parameters) {
    const term = escapeLikeTerm(query);
    if (!term) return "1 = 1";
    const pattern = `%${term}%`;
    const searchParts = [
      "lower(COALESCE(fv.title, '')) LIKE lower(?) ESCAPE '\\'",
      "lower(COALESCE(fv.publicationTitle, '')) LIKE lower(?) ESCAPE '\\'",
      "lower(COALESCE(fv.publisher, '')) LIKE lower(?) ESCAPE '\\'",
      "lower(COALESCE(it.typeName, '')) LIKE lower(?) ESCAPE '\\'"
    ];
    parameters.push(pattern, pattern, pattern, pattern);
    if (this._hasTable("itemCreators") && this._hasTable("creators")) {
      searchParts.push(`EXISTS (
        SELECT 1
        FROM itemCreators searchIc
        JOIN creators searchC ON searchC.creatorID = searchIc.creatorID
        WHERE searchIc.itemID = i.itemID
          AND lower(trim(COALESCE(searchC.firstName, '') || ' ' || COALESCE(searchC.lastName, ''))) LIKE lower(?) ESCAPE '\\'
      )`);
      parameters.push(pattern);
    }
    if (this._hasTable("itemTags") && this._hasTable("tags")) {
      searchParts.push(`EXISTS (
        SELECT 1
        FROM itemTags searchIt
        JOIN tags searchT ON searchT.tagID = searchIt.tagID
        WHERE searchIt.itemID = i.itemID
          AND lower(COALESCE(searchT.name, '')) LIKE lower(?) ESCAPE '\\'
      )`);
      parameters.push(pattern);
    }
    return `(${searchParts.join(" OR ")})`;
  }

  _itemWhere({ query, collection }, parameters) {
    const conditions = [this._baseItemCondition()];
    conditions.push(this._searchCondition(query, parameters));
    if (asText(collection)) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM collectionItems filterCi
        JOIN collections filterC ON filterC.collectionID = filterCi.collectionID
        WHERE filterCi.itemID = i.itemID
          AND (filterC.key = ? OR CAST(filterC.collectionID AS TEXT) = ?)
      )`);
      const collectionValue = asText(collection);
      parameters.push(collectionValue, collectionValue);
    }
    return conditions.join(" AND ");
  }

  _loadItemMetadata(database, items) {
    if (!items.length) return items;
    const itemIds = items.map((item) => item.itemId);
    const itemIdPlaceholders = placeholders(itemIds.length);
    const byId = new Map(items.map((item) => [item.itemId, item]));

    if (this._hasTable("itemCreators") && this._hasTable("creators")) {
      const rows = database.prepare(`
        SELECT ic.itemID AS itemId, ic.orderIndex, c.firstName, c.lastName, c.fieldMode
        FROM itemCreators ic
        JOIN creators c ON c.creatorID = ic.creatorID
        WHERE ic.itemID IN (${itemIdPlaceholders})
        ORDER BY ic.itemID, ic.orderIndex
      `).all(...itemIds);
      for (const row of rows) {
        const item = byId.get(asNumber(row.itemId));
        const name = creatorName(row);
        if (item && name) item.creators.push(name);
      }
    }

    if (this._hasTable("itemTags") && this._hasTable("tags")) {
      const rows = database.prepare(`
        SELECT it.itemID AS itemId, t.name
        FROM itemTags it
        JOIN tags t ON t.tagID = it.tagID
        WHERE it.itemID IN (${itemIdPlaceholders})
        ORDER BY it.itemID, t.name COLLATE NOCASE
      `).all(...itemIds);
      for (const row of rows) {
        const item = byId.get(asNumber(row.itemId));
        const name = asText(row.name);
        if (item && name) item.tags.push(name);
      }
    }

    if (this._hasTable("collectionItems") && this._hasTable("collections")) {
      const rows = database.prepare(`
        SELECT
          ci.itemID AS itemId,
          c.collectionID AS id,
          c.collectionID AS collectionId,
          c.collectionName AS name,
          c.parentCollectionID AS parentCollectionId,
          c.libraryID AS libraryId,
          c.key AS key
        FROM collectionItems ci
        JOIN collections c ON c.collectionID = ci.collectionID
        WHERE ci.itemID IN (${itemIdPlaceholders})
        ORDER BY ci.itemID, c.collectionName COLLATE NOCASE
      `).all(...itemIds);
      for (const row of rows) {
        const item = byId.get(asNumber(row.itemId));
        if (!item) continue;
        item.collections.push({
          id: asNumber(row.id),
          collectionId: asNumber(row.collectionId),
          name: asText(row.name) || "未命名集合",
          parentCollectionId: row.parentCollectionId === null ? null : asNumber(row.parentCollectionId),
          libraryId: asNumber(row.libraryId),
          key: asText(row.key)
        });
      }
    }

    if (this._hasTable("itemNotes")) {
      const rows = database.prepare(`
        SELECT parentItemID AS itemId, COUNT(*) AS count
        FROM itemNotes
        WHERE parentItemID IN (${itemIdPlaceholders})
        GROUP BY parentItemID
      `).all(...itemIds);
      for (const row of rows) {
        const item = byId.get(asNumber(row.itemId));
        if (item) item.noteCount = asNumber(row.count);
      }
    }

    if (this._hasTable("itemAttachments")) {
      const rows = database.prepare(`
        SELECT parentItemID AS itemId, COUNT(*) AS count
        FROM itemAttachments
        WHERE parentItemID IN (${itemIdPlaceholders})
        GROUP BY parentItemID
      `).all(...itemIds);
      for (const row of rows) {
        const item = byId.get(asNumber(row.itemId));
        if (item) item.attachmentCount = asNumber(row.count);
      }
    }

    for (const item of items) {
      item.creatorText = item.creators.join("、");
      item.collectionKeys = item.collections.map((collection) => collection.key).filter(Boolean);
      item.collectionNames = item.collections.map((collection) => collection.name);
      item.notes = item.noteCount;
      item.attachments = item.attachmentCount;
    }
    return items;
  }

  getItems({ q = "", collection = "", limit = DEFAULT_ZOTERO_LIMIT, offset = 0 } = {}) {
    const normalizedLimit = boundedInteger(limit, DEFAULT_ZOTERO_LIMIT, 1, MAX_ZOTERO_LIMIT);
    const normalizedOffset = boundedInteger(offset, 0, 0, MAX_ZOTERO_OFFSET);
    const query = asText(q).slice(0, SEARCH_LIMIT);
    const collectionValue = asText(collection).slice(0, 120);
    try {
      const database = this._open();
      this._requireTables(["items", "itemTypes", "itemData", "itemDataValues"]);
      const countParameters = [];
      const where = this._itemWhere({ query, collection: collectionValue }, countParameters);
      const cte = this._fieldValuesCte();
      const from = `
        FROM items i
        JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
        LEFT JOIN field_values fv ON fv.itemID = i.itemID
      `;
      const totalRow = database.prepare(`${cte} SELECT COUNT(*) AS total ${from} WHERE ${where}`).get(...countParameters);
      const total = asNumber(totalRow?.total);

      const pageParameters = [];
      const pageWhere = this._itemWhere({ query, collection: collectionValue }, pageParameters);
      const rows = database.prepare(`${cte}
        SELECT
          i.itemID AS itemId,
          i.itemID AS id,
          i.key AS key,
          i.libraryID AS libraryId,
          i.dateAdded AS dateAdded,
          i.dateModified AS updatedAt,
          it.typeName AS itemType,
          fv.title AS title,
          COALESCE(NULLIF(TRIM(fv.date), ''), NULLIF(TRIM(fv.year), '')) AS date,
          COALESCE(
            NULLIF(TRIM(fv.publicationTitle), ''),
            NULLIF(TRIM(fv.bookTitle), ''),
            NULLIF(TRIM(fv.conferenceName), ''),
            NULLIF(TRIM(fv.proceedingsTitle), ''),
            NULLIF(TRIM(fv.publisher), '')
          ) AS publication
        ${from}
        WHERE ${pageWhere}
        ORDER BY i.dateModified DESC, i.itemID DESC
        LIMIT ? OFFSET ?
      `).all(...pageParameters, normalizedLimit, normalizedOffset);

      const items = rows.map((row) => ({
        id: asNumber(row.id),
        itemId: asNumber(row.itemId),
        key: asText(row.key),
        zoteroKey: asText(row.key),
        libraryId: asNumber(row.libraryId),
        title: asText(row.title) || "未命名条目",
        creators: [],
        creatorText: "",
        year: extractYear(row.date),
        date: asText(row.date),
        itemType: asText(row.itemType) || "unknown",
        type: asText(row.itemType) || "unknown",
        publication: asText(row.publication),
        tags: [],
        collections: [],
        collectionKeys: [],
        collectionNames: [],
        noteCount: 0,
        attachmentCount: 0,
        notes: 0,
        attachments: 0,
        dateAdded: asText(row.dateAdded),
        updatedAt: asText(row.updatedAt)
      }));
      this._loadItemMetadata(database, items);
      const hasMore = normalizedOffset + items.length < total;
      return {
        ...responseBase(total > 0 ? "connected" : "empty", total > 0 ? "" : (query || collectionValue ? "没有匹配的文献。" : "还没有可显示的文献。")),
        items,
        total,
        limit: normalizedLimit,
        offset: normalizedOffset,
        hasMore,
        query: query,
        collection: collectionValue
      };
    } catch (error) {
      this.logger.warn?.(`[codex-control-console] Zotero items unavailable: ${error.message}`);
      return {
        ...this._disconnected(error),
        items: [],
        total: 0,
        limit: normalizedLimit,
        offset: normalizedOffset,
        hasMore: false,
        query,
        collection: collectionValue
      };
    }
  }

  close() {
    this._discardDatabase();
  }
}

export function createZoteroAdapter(options) {
  return new ZoteroAdapter(options);
}
