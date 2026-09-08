import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ZoteroAdapter } from "../src/zotero-adapter.mjs";

async function makeFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-zotero-test-"));
  const databasePath = path.join(directory, "zotero.sqlite");

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT NOT NULL, editable INTEGER NOT NULL, filesEditable INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT NOT NULL);
    CREATE TABLE fieldsCombined (fieldID INTEGER PRIMARY KEY, fieldName TEXT NOT NULL);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER NOT NULL, dateAdded TEXT, dateModified TEXT, libraryID INTEGER NOT NULL, key TEXT NOT NULL);
    CREATE TABLE itemData (itemID INTEGER NOT NULL, fieldID INTEGER NOT NULL, valueID INTEGER NOT NULL, PRIMARY KEY (itemID, fieldID));
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT NOT NULL, parentCollectionID INTEGER, libraryID INTEGER NOT NULL, key TEXT NOT NULL);
    CREATE TABLE collectionItems (collectionID INTEGER NOT NULL, itemID INTEGER NOT NULL, PRIMARY KEY (collectionID, itemID));
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INTEGER DEFAULT 0);
    CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
    CREATE TABLE itemCreators (itemID INTEGER NOT NULL, creatorID INTEGER NOT NULL, creatorTypeID INTEGER NOT NULL, orderIndex INTEGER NOT NULL, PRIMARY KEY (itemID, orderIndex));
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE itemTags (itemID INTEGER NOT NULL, tagID INTEGER NOT NULL, type INTEGER NOT NULL, PRIMARY KEY (itemID, tagID));
    CREATE TABLE itemNotes (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, note TEXT, title TEXT);
    CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, linkMode INTEGER, contentType TEXT, path TEXT);
    CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
  `);
  database.prepare("INSERT INTO libraries VALUES (1, 'user', 1, 1, 0)").run();
  database.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(7, "book");
  database.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(22, "journalArticle");
  database.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(28, "note");
  database.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(3, "attachment");
  database.prepare("INSERT INTO itemTypes VALUES (?, ?)").run(1, "annotation");
  database.prepare("INSERT INTO fieldsCombined VALUES (?, ?)").run(1, "title");
  database.prepare("INSERT INTO fieldsCombined VALUES (?, ?)").run(2, "date");
  database.prepare("INSERT INTO fieldsCombined VALUES (?, ?)").run(3, "publicationTitle");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(1, 22, "2024-01-01", "2026-08-20", 1, "ITEMONE");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(2, 7, "2023-01-01", "2026-08-19", 1, "ITEMTWO");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(3, 28, "2026-08-18", "2026-08-18", 1, "NOTEONE");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(4, 3, "2026-08-17", "2026-08-17", 1, "ATTACH1");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(5, 1, "2026-08-16", "2026-08-16", 1, "ANNOT1");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(1, "A Study of Markets");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(2, "2024-05-00");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(3, "Journal of Testing");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(4, "A Second Book");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(5, "2019");
  database.prepare("INSERT INTO itemDataValues VALUES (?, ?)").run(6, "Test Press");
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(1, 1, 1);
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(1, 2, 2);
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(1, 3, 3);
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(2, 1, 4);
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(2, 2, 5);
  database.prepare("INSERT INTO itemData VALUES (?, ?, ?)").run(2, 3, 6);
  database.prepare("INSERT INTO collections VALUES (?, ?, ?, ?, ?)").run(10, "Research", null, 1, "COLROOT");
  database.prepare("INSERT INTO collections VALUES (?, ?, ?, ?, ?)").run(11, "Markets", 10, 1, "COLCHILD");
  database.prepare("INSERT INTO collectionItems VALUES (?, ?)").run(10, 1);
  database.prepare("INSERT INTO collectionItems VALUES (?, ?)").run(11, 2);
  database.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)").run(1, "Ada", "Lovelace", 0);
  database.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)").run(2, null, "Market Research Group", 1);
  database.prepare("INSERT INTO creatorTypes VALUES (?, ?)").run(8, "author");
  database.prepare("INSERT INTO itemCreators VALUES (?, ?, ?, ?)").run(1, 1, 8, 0);
  database.prepare("INSERT INTO itemCreators VALUES (?, ?, ?, ?)").run(2, 2, 8, 0);
  database.prepare("INSERT INTO tags VALUES (?, ?)").run(1, "finance");
  database.prepare("INSERT INTO itemTags VALUES (?, ?, ?)").run(1, 1, 0);
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(6, 28, "2026-08-15", "2026-08-15", 1, "NOTECHILD");
  database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)").run(7, 3, "2026-08-15", "2026-08-15", 1, "ATTCHILD");
  database.prepare("INSERT INTO itemNotes VALUES (?, ?, ?, ?)").run(3, null, "standalone", "Standalone note");
  database.prepare("INSERT INTO itemNotes VALUES (?, ?, ?, ?)").run(6, 1, "child", "A note");
  database.prepare("INSERT INTO itemAttachments VALUES (?, ?, ?, ?, ?)").run(4, 1, 0, "application/pdf", "storage:private.pdf");
  database.close();
  return databasePath;
}

test("Zotero adapter reads status, hierarchy, and bounded metadata without writes", async (t) => {
  const databasePath = await makeFixture(t);
  let openedDatabase;
  const adapter = new ZoteroAdapter({
    databasePath,
    databaseFactory: (filePath, options) => {
      openedDatabase = new DatabaseSync(filePath, options);
      return openedDatabase;
    }
  });
  t.after(async () => {
    adapter.close();
    await fs.rm(path.dirname(databasePath), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const status = adapter.getStatus();
  assert.equal(status.status, "connected");
  assert.equal(status.readOnly, true);
  assert.deepEqual(status.counts, {
    items: 2,
    itemRows: 7,
    collections: 2,
    attachments: 1,
    notes: 2,
    libraries: 1,
    deletedItems: 0
  });
  assert.equal(openedDatabase.prepare("PRAGMA query_only").get().query_only, 1);
  assert.throws(() => openedDatabase.exec("CREATE TABLE should_not_write(value TEXT)"), /readonly/i);

  const collections = adapter.getCollections();
  assert.equal(collections.status, "connected");
  assert.deepEqual(collections.collections.map((collection) => [collection.name, collection.depth, collection.itemCount]), [
    ["Research", 0, 1],
    ["Markets", 1, 1]
  ]);

  const page = adapter.getItems({ q: "finance", limit: 1, offset: 0 });
  assert.equal(page.status, "connected");
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0], {
    id: 1,
    itemId: 1,
    key: "ITEMONE",
    zoteroKey: "ITEMONE",
    libraryId: 1,
    title: "A Study of Markets",
    creators: ["Ada Lovelace"],
    creatorText: "Ada Lovelace",
    year: 2024,
    date: "2024-05-00",
    itemType: "journalArticle",
    type: "journalArticle",
    publication: "Journal of Testing",
    tags: ["finance"],
    collections: [{ id: 10, collectionId: 10, name: "Research", parentCollectionId: null, libraryId: 1, key: "COLROOT" }],
    collectionKeys: ["COLROOT"],
    collectionNames: ["Research"],
    noteCount: 1,
    attachmentCount: 1,
    notes: 1,
    attachments: 1,
    dateAdded: "2024-01-01",
    updatedAt: "2026-08-20"
  });

  const filtered = adapter.getItems({ collection: "COLCHILD", limit: 10 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].title, "A Second Book");
  assert.equal(filtered.items[0].creators[0], "Market Research Group");
});

test("missing Zotero database reports disconnected without exposing its path", () => {
  const adapter = new ZoteroAdapter({ databasePath: "/tmp/does-not-exist/codex-zotero.sqlite" });
  const status = adapter.getStatus();
  assert.equal(status.status, "disconnected");
  assert.match(status.message, /Zotero/);
  assert.doesNotMatch(status.message, /does-not-exist/);
  assert.deepEqual(adapter.getItems({ limit: 999 }), {
    status: "disconnected",
    source: "本机 Zotero",
    sourceType: "local-zotero-sqlite",
    readOnly: true,
    counts: { items: 0, itemRows: 0, collections: 0, attachments: 0, notes: 0, libraries: 0, deletedItems: 0 },
    message: status.message,
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
    hasMore: false,
    query: "",
    collection: ""
  });
});
