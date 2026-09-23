import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { inputSourceFromSessionRecord } from './session-input-source.mjs';
import { userTextFromSessionRecord } from './session-title.mjs';

const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const inside = (root, file) => file.startsWith(root + path.sep);
const db = new DatabaseSync(workerData.databasePath);
await fs.chmod(workerData.databasePath, 0o600);
db.exec(`
  CREATE TABLE IF NOT EXISTS indexed_files (
    path TEXT PRIMARY KEY, session_id TEXT NOT NULL, size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL, identity TEXT NOT NULL, append_safe INTEGER NOT NULL
  );
`);
if (db.prepare('PRAGMA user_version').get().user_version !== 2) {
  db.exec(`DROP TABLE IF EXISTS sent_messages; DELETE FROM indexed_files; PRAGMA user_version = 2;`);
}
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS sent_messages USING fts5(
  session_id UNINDEXED, sent_at UNINDEXED, display UNINDEXED, body, tokenize='trigram'
);`);

const fileRecord = db.prepare('SELECT session_id, size, mtime_ms, identity, append_safe FROM indexed_files WHERE path = ?');
const fileRows = db.prepare('SELECT path, session_id FROM indexed_files');
const deleteMessages = db.prepare('DELETE FROM sent_messages WHERE session_id = ?');
const deleteFile = db.prepare('DELETE FROM indexed_files WHERE path = ?');
const saveFile = db.prepare(`INSERT INTO indexed_files(path, session_id, size, mtime_ms, identity, append_safe)
  VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET session_id=excluded.session_id,
  size=excluded.size, mtime_ms=excluded.mtime_ms, identity=excluded.identity, append_safe=excluded.append_safe`);
const insertMessage = db.prepare('INSERT INTO sent_messages(session_id, sent_at, display, body) VALUES (?, ?, ?, ?)');
const queryMessages = db.prepare(`SELECT session_id, sent_at, display, body FROM sent_messages
  WHERE body GLOB ? ORDER BY sent_at DESC LIMIT 10000`);
const rootPaths = await Promise.all(workerData.sessionRoots.map(root => fs.realpath(root).catch(() => null)));
let ready = false;
let progress = { indexed: 0, total: 0 };
let failures = 0;
let pendingSync = null;
let syncing = false;

function globPattern(query) {
  const literal = [...query].map(char => char === '*' ? '[*]' : char === '?' ? '[?]' : char === '[' ? '[[]' : char).join('');
  return `*${literal}*`;
}

async function indexFile(item) {
  const file = await fs.realpath(item.transcriptPath);
  if (!rootPaths.some(root => root && inside(root, file))) throw new Error('transcript outside configured roots');
  const before = await fs.stat(file);
  if (!before.isFile()) throw new Error('transcript is not a file');
  const identity = `${before.dev}:${before.ino}`;
  const prior = fileRecord.get(item.transcriptPath);
  if (prior && prior.session_id === item.id && prior.size === before.size && prior.mtime_ms === before.mtimeMs && prior.identity === identity) return;
  const append = prior && prior.session_id === item.id && prior.identity === identity && prior.append_safe && before.size > prior.size;
  const start = append ? prior.size : 0;
  const lines = readline.createInterface({ input: createReadStream(file, { start, encoding: 'utf8' }), crlfDelay: Infinity });
  db.exec('BEGIN');
  try {
    if (!append) {
      if (prior) deleteMessages.run(item.id);
      if (prior && prior.session_id !== item.id) deleteMessages.run(prior.session_id);
    }
    for await (const line of lines) {
      const envelope = line.slice(0, 1024);
      if (!((envelope.includes('"type":"response_item"') && envelope.includes('"role":"user"')) ||
        (envelope.includes('"type":"event_msg"') && envelope.includes('"type":"user_message"')))) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (inputSourceFromSessionRecord(record) !== 'user') continue;
      const display = userTextFromSessionRecord(record);
      const body = normalize(display);
      if (body) insertMessage.run(item.id, record.timestamp || '', display, body);
    }
    const after = await fs.stat(file);
    if (`${after.dev}:${after.ino}` !== identity || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('transcript changed while indexing');
    }
    let appendSafe = 0;
    if (after.size > 0) {
      const handle = await fs.open(file, 'r');
      try {
        const byte = Buffer.alloc(1);
        await handle.read(byte, 0, 1, after.size - 1);
        appendSafe = Number(byte[0] === 10);
      } finally { await handle.close(); }
    }
    saveFile.run(item.transcriptPath, item.id, after.size, after.mtimeMs, identity, appendSafe);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { lines.close(); }
}

async function runSync(items) {
  ready = false;
  progress = { indexed: 0, total: items.length };
  parentPort.postMessage({ type: 'progress', ...progress, ready });
  const keep = new Set(items.map(item => item.transcriptPath));
  for (const row of fileRows.all()) {
    if (keep.has(row.path)) continue;
    db.exec('BEGIN');
    try { deleteMessages.run(row.session_id); deleteFile.run(row.path); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  failures = 0;
  for (const item of items) {
    try { await indexFile(item); } catch { failures++; }
    progress.indexed++;
    if (progress.indexed % 20 === 0 || progress.indexed === progress.total) {
      parentPort.postMessage({ type: 'progress', ...progress, ready: false });
    }
  }
  ready = true;
  parentPort.postMessage({ type: 'progress', ...progress, ready, failures });
}

async function drain() {
  if (syncing) return;
  syncing = true;
  try {
    while (pendingSync) {
      const items = pendingSync;
      pendingSync = null;
      await runSync(items);
    }
  } catch (error) {
    ready = false;
    parentPort.postMessage({ type: 'error', message: error.message });
  } finally { syncing = false; }
}

parentPort.on('message', message => {
  if (message?.type === 'sync' && Array.isArray(message.items)) {
    pendingSync = message.items;
    void drain();
  } else if (message?.type === 'search' && Number.isSafeInteger(message.id)) {
    try {
      const rows = queryMessages.all(globPattern(message.query));
      const seen = new Set();
      const items = [];
      for (const row of rows) {
        if (!row.body.includes(message.query) || seen.has(row.session_id)) continue;
        seen.add(row.session_id);
        const position = row.body.indexOf(message.query);
        const start = Math.max(0, position - 65);
        items.push({ id: row.session_id, at: row.sent_at, excerpt: (start ? '…' : '') + row.display.slice(start, start + 190) + (start + 190 < row.display.length ? '…' : '') });
        if (items.length >= 60) break;
      }
      parentPort.postMessage({ type: 'searchResult', id: message.id, items, incomplete: !ready || failures > 0 || rows.length >= 10000, progress });
    } catch (error) { parentPort.postMessage({ type: 'searchResult', id: message.id, error: error.message }); }
  }
});
