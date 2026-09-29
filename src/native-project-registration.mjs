import { CdpConnection, chooseMainTarget, discoverTargets } from './cdp-client.mjs';

export function findNativeProjectHost(exports) {
  const getters = Object.values(exports).filter(value => typeof value === 'function'
    && /Project operations are not supported by this host/.test(Function.prototype.toString.call(value)));
  if (getters.length !== 1) throw Error('当前原生版本的项目登记能力无法确认');
  const host = getters[0]();
  if (typeof host?.createProjectForRoot !== 'function') throw Error('当前原生版本不支持项目登记');
  return host;
}

// Long-running windows can evict the initial chunk from Resource Timing. Resolve it
// from the native entry module as well, never from remote or user-controlled URLs.
export async function loadNativeProjectHost(find, importer = url => import(url)) {
  const valid = value => { try { const url = new URL(value, location.href); return url.protocol === 'app:' && url.host === '-' && /^\/assets\/app-initial-[\w-]+\.js$/.test(url.pathname) ? url.href : null; } catch { return null; } };
  let urls = [...new Set(performance.getEntriesByType('resource').map(entry => valid(entry.name)).filter(Boolean))];
  if (!urls.length) {
    const entries = [...document.querySelectorAll('script[type="module"][src]')].map(node => new URL(node.src, location.href)).filter(url => url.protocol === 'app:' && url.host === '-' && /^\/assets\/index-[\w-]+\.js$/.test(url.pathname));
    if (entries.length !== 1) throw Error('原生项目入口尚未就绪');
    const response = await fetch(entries[0].href);
    if (!response.ok) throw Error('原生项目入口不可读取');
    const source = await response.text();
    urls = [...new Set([...source.matchAll(/(?:["'`])(?:\.\/|\/assets\/)?(app-initial-[\w-]+\.js)(?:["'`])/g)].map(match => valid(new URL(match[1], entries[0]).href)).filter(Boolean))];
  }
  if (urls.length !== 1) throw Error('原生项目模块无法唯一确认');
  return find(await importer(urls[0]));
}

export class NativeProjectRegistration {
  constructor({ cdpOrigin, sidebar, discover = discoverTargets, choose = chooseMainTarget,
    connectionFactory = url => new CdpConnection(url, { commandTimeoutMs: 55000 }) }) {
    Object.assign(this, { cdpOrigin, sidebar, discover, choose, connectionFactory });
  }
  async call(input = null) {
    const target = this.choose(await this.discover(this.cdpOrigin));
    const connection = this.connectionFactory(target.webSocketDebuggerUrl);
    try {
      await connection.connect();
      const expression = `(${loadNativeProjectHost.toString()})(${findNativeProjectHost.toString()})`;
      return await connection.evaluate(input?.read === true ? `${expression}.then(async host=>Object.values(await host.getLocalProjects()).map(p=>({id:p.id,name:p.name,roots:p.rootPaths})))` : input === null ? `${expression}.then(()=>true)`
        : `${expression}.then(async host=>{const p=await host.createProjectForRoot(${JSON.stringify(input.path)},${JSON.stringify(input.name)});return p?{id:p.id,roots:p.rootPaths}:null})`);
    } finally { await connection.close().catch(() => {}); }
  }
  async catalog() {
    const projects = await this.call({ read: true });
    if (!Array.isArray(projects) || projects.length > 5000) throw Error('原生项目登记清单不可确认');
    const unique = new Map();
    for (const project of projects) {
      if (typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.roots)) throw Error('原生项目登记格式无效');
      if (project.roots.length === 1 && typeof project.roots[0] === 'string') unique.set(project.roots[0], { id: project.id, path: project.roots[0], name: project.name });
    }
    return [...unique.values()];
  }
  async ready() { await this.catalog(); return this.call(); }
  async register(input) {
    let result;
    try { result = await this.call(input); }
    catch { throw Error('原生项目登记未返回确认，请在目标桌面处理目录提示并核对副本'); }
    if (!result?.id || result.roots?.length !== 1 || result.roots[0] !== input.path) throw Error('原生项目尚未确认登记；请在目标设备处理目录确认并核对保留的副本');
    for (let attempt = 0; attempt < 12; attempt++) {
      const projects = await this.catalog();
      if (projects.some(p => p.id === result.id && p.path === input.path)) return { projectId: result.id };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error('原生项目登记读回未确认；副本已保留');
  }
}
