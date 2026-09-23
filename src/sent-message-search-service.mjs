import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { inputSourceFromSessionRecord } from './session-input-source.mjs';
import { userTextFromSessionRecord } from './session-title.mjs';

const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const regexLiteral = value => [...value].map(char => {
  if (/[a-z0-9]/.test(char)) return `[${char}${String.fromCharCode(char.charCodeAt(0) + 65248)}]`;
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}).join('');

export async function findSentMatchesInRoots(roots, query, allowed) {
  const term = regexLiteral(query);
  const patterns = [
    `^.{0,120}"type":"response_item","payload":\\{"type":"message".*"role":"user".*${term}`,
    `^.{0,120}"type":"event_msg","payload":\\{"type":"user_message".*${term}`
  ];
  const child = spawn('rg', ['--json', '--no-ignore', '-i', '-g', '*.jsonl', ...patterns.flatMap(pattern => ['-e', pattern]), ...roots], { stdio: ['ignore', 'pipe', 'pipe'] });
  const matches = new Map();
  let skipped = false;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-300); });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let value;
      try { value = JSON.parse(line); } catch { skipped = true; continue; }
      if (value.type !== 'match') continue;
      const file = value.data?.path?.text;
      if (!allowed.has(file)) continue;
      const source = value.data?.lines?.text;
      if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) { skipped = true; continue; }
      let record;
      try { record = JSON.parse(source); } catch { skipped = true; continue; }
      if (inputSourceFromSessionRecord(record) !== 'user') continue;
      const message = userTextFromSessionRecord(record);
      const position = normalize(message).indexOf(query);
      if (position < 0) continue;
      const start = Math.max(0, position - 65);
      const at = record.timestamp || null;
      const previous = matches.get(file);
      if (!previous || String(at || '') >= String(previous.at || '')) {
        matches.set(file, { excerpt: (start ? '…' : '') + message.slice(start, start + 190) + (start + 190 < message.length ? '…' : ''), at });
      }
    }
  } finally { lines.close(); }
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0 && code !== 1) throw new Error(`message search prefilter failed: ${stderr || code}`);
  return { matches, skipped };
}

export async function findLatestSentMatch(file, query) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let match = null;
  try {
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (inputSourceFromSessionRecord(record) !== 'user') continue;
      const message = userTextFromSessionRecord(record);
      const position = normalize(message).indexOf(query);
      if (position < 0) continue;
      const start = Math.max(0, position - 65);
      match = { excerpt: (start ? '…' : '') + message.slice(start, start + 190) + (start + 190 < message.length ? '…' : ''),
        at: record.timestamp || null };
    }
  } finally { lines.close(); }
  return match;
}

export class SentMessageSearchService {
  constructor({ catalog, index = null, readMatch = findLatestSentMatch, fastSearch = findSentMatchesInRoots } = {}) {
    this.catalog = catalog;
    this.index = index;
    this.readMatch = readMatch;
    this.fastSearch = fastSearch;
  }

  async prepare() {
    if (!this.index) return;
    const snapshot = await this.catalog.snapshot();
    this.index.sync(snapshot.conversations.filter(item => !item.archived && !item.internal && item.transcriptPath), { force: true });
  }

  async search(rawQuery) {
    const query = normalize(rawQuery).trim();
    if (!query || query.length > 120) return { items: [], incomplete: false };
    const snapshot = await this.catalog.snapshot();
    const conversations = snapshot.conversations.filter(item => !item.archived && !item.internal && item.transcriptPath);
    const items = [];
    let failures = 0;
    if (this.index) {
      try {
        this.index.sync(conversations);
        const indexed = await this.index.search(query);
        const byId = new Map(conversations.map(item => [item.id, item]));
        const matches = indexed.items.filter(item => byId.has(item.id)).map(item => ({ ...item,
          title: byId.get(item.id).title, updatedAt: byId.get(item.id).updatedAt }));
        return { items: matches.slice(0, 30), incomplete: snapshot.truncated || indexed.incomplete || matches.length > 30,
          indexing: indexed.progress?.ready ? null : indexed.progress };
      } catch { /* Retain the read-only transcript search if the local index is unavailable. */ }
    }
    if (this.readMatch === findLatestSentMatch && this.catalog.sessionRoots?.length) {
      try {
        const byPath = new Map(conversations.map(item => [item.transcriptPath, item]));
        const found = await this.fastSearch(this.catalog.sessionRoots, query, new Set(byPath.keys()));
        for (const [file, match] of found.matches) {
          const item = byPath.get(file);
          items.push({ id: item.id, title: item.title, excerpt: match.excerpt, at: match.at, updatedAt: item.updatedAt });
        }
        items.sort((a, b) => String(b.at || b.updatedAt || '').localeCompare(String(a.at || a.updatedAt || '')) || a.id.localeCompare(b.id));
        return { items: items.slice(0, 30), incomplete: snapshot.truncated || found.skipped || items.length > 30 };
      } catch { /* Fall back when ripgrep is unavailable. */ }
    }
    let cursor = 0;
    const worker = async () => {
      while (cursor < conversations.length) {
        const item = conversations[cursor++];
        try {
          const file = await this.catalog.transcriptPath(item);
          const match = await this.readMatch(file, query);
          if (match) items.push({ id: item.id, title: item.title, excerpt: match.excerpt, at: match.at, updatedAt: item.updatedAt });
        } catch { failures++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, conversations.length) }, () => worker()));
    items.sort((a, b) => String(b.at || b.updatedAt || '').localeCompare(String(a.at || a.updatedAt || '')) || a.id.localeCompare(b.id));
    return { items: items.slice(0, 30), incomplete: snapshot.truncated || failures > 0 || items.length > 30 };
  }
}
