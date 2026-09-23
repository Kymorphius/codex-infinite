import fs from 'node:fs';
import readline from 'node:readline';
import { inputSourceFromSessionRecord } from './session-input-source.mjs';
import { userTextFromSessionRecord } from './session-title.mjs';

const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();

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
  constructor({ catalog, readMatch = findLatestSentMatch } = {}) {
    this.catalog = catalog;
    this.readMatch = readMatch;
  }

  async search(rawQuery) {
    const query = normalize(rawQuery).trim();
    if (!query || query.length > 120) return { items: [], incomplete: false };
    const snapshot = await this.catalog.snapshot();
    const conversations = snapshot.conversations.filter(item => !item.archived && !item.internal && item.transcriptPath);
    const items = [];
    let failures = 0;
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
