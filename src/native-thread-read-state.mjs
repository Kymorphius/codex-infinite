import { CdpConnection, chooseMainTarget, discoverTargets } from './cdp-client.mjs';
import { readNativeSidebarModel } from './native-sidebar-model.mjs';

// Resolve the native read/subscribe projection semantically, never by a minified name.
export function findNativeReadStateExport(source) {
  const bindings = [...source.matchAll(/([\w$]+)=[\w$]+\([\w$]+,\(\)=>([\w$]+)\.read\(\),\(\{set:([\w$]+)\}\)=>\2\.subscribe\(\(\)=>\3\(\2\.read\(\)\)\)\)/g)];
  if (bindings.length !== 1) throw Error('Native read-state binding unavailable');
  const exports = source.slice(source.lastIndexOf('export{') + 7).split('}')[0].split(',');
  const names = exports.map(entry => entry.trim().split(/\s+as\s+/)).filter(([name]) => name === bindings[0][1]);
  if (names.length !== 1 || !/^[\w$]+$/.test(names[0][1] || '')) throw Error('Native read-state export unavailable');
  return names[0][1];
}

export function normalizeNativeUnreadIds(value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw Error('Native unread state unavailable');
  }
  return [...new Set(value.map(id => id.toLowerCase()))];
}

export async function readNativeUnreadIds(readModel, findExport, normalize) {
  const asset = (value, kind) => {
    try {
      const url = new URL(value);
      return url.protocol === 'app:' && url.host === '-' && !url.search && !url.hash
        && new RegExp('^/assets/' + kind + '-[\\w-]+\\.js$').test(url.pathname);
    } catch { return false; }
  };
  const readText = async url => {
    const response = await fetch(url);
    if (!response.ok) throw Error('Native read-state module unavailable');
    const source = await response.text();
    if (source.length > 24000000) throw Error('Native read-state module exceeds limit');
    return source;
  };
  const key = '__codexControlConsoleNativeReadStateBinding';
  // Cache module discovery only. Account changes and read acknowledgements are
  // reflected by scope.get on every read; no unread snapshot is stored here.
  if (!window[key]) {
    window[key] = (async () => {
      let urls = [...new Set(performance.getEntriesByType('resource').map(entry => entry.name))]
        .filter(url => asset(url, 'app-initial'));
      if (!urls.length) {
        const entries = [...document.scripts].map(script => script.src).filter(url => asset(url, 'index'));
        if (entries.length !== 1) throw Error('Native entry module unavailable');
        const source = await readText(entries[0]);
        urls = [...new Set([...source.matchAll(/["'`](\.\/app-initial-[\w-]+\.js)["'`]/g)]
          .map(match => new URL(match[1], entries[0]).href))].filter(url => asset(url, 'app-initial'));
      }
      if (urls.length !== 1) throw Error('Native read-state module ambiguous');
      const name = findExport(await readText(urls[0]));
      const module = await import(urls[0]);
      const atom = module[name];
      if (!atom || typeof atom.resolve !== 'function') throw Error('Native read-state atom unavailable');
      return atom;
    })();
  }
  let atom;
  try { atom = await window[key]; }
  catch (error) { delete window[key]; throw error; }
  const scope = readModel(document).scope;
  if (!scope) throw Error('Native read-state scope unavailable');
  const state = scope.get(atom);
  return normalize(state?.local);
}

export function buildNativeUnreadReadScript() {
  return `(${readNativeUnreadIds.toString()})(${readNativeSidebarModel.toString()},${findNativeReadStateExport.toString()},${normalizeNativeUnreadIds.toString()})`;
}

export class NativeThreadReadStateAdapter {
  constructor({ cdpOrigin, discover = discoverTargets, choose = chooseMainTarget,
    connectionFactory = url => new CdpConnection(url, { commandTimeoutMs: 15000 }) } = {}) {
    Object.assign(this, { cdpOrigin, discover, choose, connectionFactory });
  }
  async readUnreadIds() {
    let connection;
    try {
      const target = this.choose(await this.discover(this.cdpOrigin));
      if (!target) throw Error('Native read-state window unavailable');
      connection = this.connectionFactory(target.webSocketDebuggerUrl);
      await connection.connect();
      return normalizeNativeUnreadIds(await connection.evaluate(buildNativeUnreadReadScript()));
    } finally { await connection?.close().catch(() => {}); }
  }
}
