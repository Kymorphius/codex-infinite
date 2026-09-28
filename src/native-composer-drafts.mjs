import fs from 'node:fs/promises';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['composer-prompt-drafts-v2', 'composer-prompt-drafts-v1'];
const PREVIEW = 80;

// The native composer stores a draft as plain text, { prompt: text }, or
// { prompt: { document } } (a rich-text tree). Only its visible text matters here.
export function composerDraftText(value) {
  const parts = [];
  const walk = node => {
    if (parts.join('').length > PREVIEW * 2 || node == null) return;
    if (typeof node === 'string') { parts.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if (typeof node.text === 'string') parts.push(node.text);
    if (node.type === 'paragraph' && parts.length) parts.push(' ');
    walk(node.content);
  };
  const prompt = typeof value === 'string' ? value : value?.prompt;
  walk(typeof prompt === 'string' ? prompt : prompt?.document);
  return parts.join('').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, PREVIEW);
}

// Read-only view of the native app's unsent composer drafts: thread id -> preview.
// The global state file is written by the app; it is parsed again only when it changes.
export function createComposerDraftReader({ filePath }) {
  let cache = { mtimeMs: -1, size: -1, drafts: new Map() };
  return async function readDrafts() {
    let stat;
    try { stat = await fs.stat(filePath); } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
    if (stat.mtimeMs === cache.mtimeMs && stat.size === cache.size) return cache.drafts;
    let state;
    try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return cache.drafts; }
    const atoms = state?.['electron-persisted-atom-state'] || {}, drafts = new Map();
    for (const key of KEYS) {
      for (const [scope, value] of Object.entries(atoms[key] || {})) {
        const id = scope.startsWith('local:') ? scope.slice('local:'.length).toLowerCase() : '';
        if (!ID.test(id) || drafts.has(id)) continue;
        const text = composerDraftText(value);
        if (text) drafts.set(id, text);
      }
    }
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, drafts };
    return drafts;
  };
}
