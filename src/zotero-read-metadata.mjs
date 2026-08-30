import { asNumber, asText, creatorName } from "./zotero-read-contract.mjs";

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function loadItemMetadata({ database, items, hasTable }) {
  if (!items.length) return items;
  const itemIds = items.map((item) => item.itemId);
  const itemIdPlaceholders = placeholders(itemIds.length);
  const byId = new Map(items.map((item) => [item.itemId, item]));

  if (hasTable("itemCreators") && hasTable("creators")) {
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

  if (hasTable("itemTags") && hasTable("tags")) {
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

  if (hasTable("collectionItems") && hasTable("collections")) {
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

  if (hasTable("itemNotes")) {
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

  if (hasTable("itemAttachments")) {
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

