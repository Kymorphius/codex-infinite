// Read the native new-task runtime; do not change React props or mode preferences.
export function readNativeNewTaskScope(document) {
  for (const button of document.querySelectorAll('button')) {
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
    if (!['新聊天', '新对话', '新建任务', 'New chat', 'New task'].includes(label)) continue;
    let fiber = button[Object.keys(button).find(key => key.startsWith('__reactFiber'))];
    for (let depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
      if (!Object.hasOwn(fiber.memoizedProps || {}, 'homeComposerMode')) continue;
      const code = typeof fiber.type === 'function' ? Function.prototype.toString.call(fiber.type) : '';
      if (!code.includes('startNewConversationInProject') || !code.includes('startNewConversation')) continue;
      const rows = fiber.updateQueue?.memoCache?.data || [];
      const values = rows.filter(row => row.some(value => typeof value === 'function' && Function.prototype.toString.call(value).includes('startNewConversationInProject'))).flat();
      const scopes = [...new Set(values.filter(value => value && typeof value.get === 'function' && typeof value.set === 'function' && value.query && typeof value.query === 'object' && value.scope && value.node))];
      if (scopes.length === 1) return scopes[0];
    }
  }
  return null;
}
export function findNativeNewTaskAction(module) {
  const matches = [];
  for (const value of Object.values(module)) {
    let code = ''; try { code = Function.prototype.toString.call(value); } catch { continue; }
    if (['focusComposerNonce', 'prefillAeonStartTarget', 'activeProject', 'prefillChatGptSystemHints'].every(key => code.includes(key))) matches.push(value);
  }
  return matches.length === 1 ? matches[0] : null;
}
export function findNativeNewTaskModuleUrls(document, performance) {
  function validUrls(values) {
    const urls = new Set();
    for (const value of values) {
      try {
        const url = new URL(value, document.baseURI || 'app://-/');
        if (url.protocol === 'app:' && url.host === '-' && !url.username && !url.password && !url.search && !url.hash && /^\/assets\/app-initial-[\w-]+\.js$/.test(url.pathname)) urls.add(url.href);
      } catch {}
    }
    return [...urls];
  }
  const manifest = validUrls(Array.from(document.querySelectorAll('script[type="module"][src],link[rel="modulepreload"][href],link[rel="preload"][as="script"][href]'), node => node.src || node.href));
  if (manifest.length) return manifest;
  return validUrls(performance.getEntriesByType('resource').map(entry => entry.name));
}
export function installNativeNewTaskAdapter(readScope, findAction, findModules) {
  const VERSION = '2026-09-12.module-discovery1';
  if (window.__cccNativeNewTask?.version === VERSION) return;
  let actionPromise;
  async function action() {
    if (!actionPromise) actionPromise = (async () => {
      const urls = findModules(document, performance);
      if (urls.length !== 1) throw Error('原生新建任务服务尚未就绪');
      const start = findAction(await import(urls[0]));
      if (!start) throw Error('原生新建任务服务暂不可用');
      return start;
    })().catch(error => { actionPromise = null; throw error; });
    return actionPromise;
  }
  window.__cccNativeNewTask = { version: VERSION,
    async start(projectId) {
      if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 200) throw Error('项目暂不可用');
      const start = await action(), scope = readScope(document);
      if (!scope) throw Error('原生新建任务入口尚未就绪');
      window.__codexControlConsoleClose?.();
      start(scope, { activeProject: { projectId, projectKind: 'local' } });
      return true;
    }
  };
}
export function buildNativeNewTaskAdapterScript() {
  return `(${installNativeNewTaskAdapter.toString()})(${readNativeNewTaskScope.toString()},${findNativeNewTaskAction.toString()},${findNativeNewTaskModuleUrls.toString()});`;
}
