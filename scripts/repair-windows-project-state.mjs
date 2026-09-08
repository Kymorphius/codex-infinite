import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../src/config.mjs';
import { AppServerClient } from '../src/app-server-client.mjs';
import { CdpConnection, chooseMainTarget, discoverTargets } from '../src/cdp-client.mjs';
import { planMissingSidebarProjects } from '../src/project-state-recovery.mjs';

async function nativeStateRequest(method, params) {
  const requestId = 'console-project-recovery-' + crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('native state request timed out')); }, 6000);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = event => {
      const data = event.data;
      if (data?.type !== 'fetch-response' || data.requestId !== requestId) return;
      cleanup();
      if (data.responseType === 'error') reject(new Error(data.error));
      else { try { resolve(JSON.parse(data.bodyJsonString)); } catch (error) { reject(error); } }
    };
    window.addEventListener('message', receive);
    Promise.resolve(window.electronBridge.sendMessageFromView({
      type: 'fetch', requestId, method: 'POST', url: 'vscode://codex/' + method,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(params)
    })).catch(error => { cleanup(); reject(error); });
  });
}

async function main() {
  if (process.platform !== 'win32') throw Error('Windows-only recovery');
  const config = getConfig();
  const retained = JSON.parse(await fs.readFile(path.join(config.wrapperCodexHome, '.codex-global-state.json'), 'utf8'));
  const sourcePath = path.join(config.sourceCodexHome, '.codex-global-state.json');
  const client = new AppServerClient({ codexPath: config.codexPath, codexHome: config.nativeCodexHome });
  const serverProjects = [];
  try {
    await client.initialize(); let cursor = null;
    do {
      const page = await client.request('project/list', { cursor, limit: 100 });
      serverProjects.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
  } finally { client.close(); }
  const connection = new CdpConnection(chooseMainTarget(await discoverTargets(config.cdpOrigin)).webSocketDebuggerUrl);
  await connection.connect();
  const request = (method, params) => connection.evaluate(`(${nativeStateRequest.toString()})(${JSON.stringify(method)},${JSON.stringify(params)})`);
  try {
    const activeProjects = (await request('get-global-state', { key: 'local-projects' })).value || {};
    const allMappings = (await request('get-global-state', { key: 'app-server-project-id-by-legacy-project-id-by-host' })).value || {};
    const sourceHost = `local:${config.sourceCodexHome}`;
    const retainedHost = `local:${config.wrapperCodexHome}`;
    const result = planMissingSidebarProjects({
      activeProjects, activeMappings: allMappings[sourceHost], serverProjects,
      retainedProjects: retained['local-projects'],
      retainedMappings: retained['app-server-project-id-by-legacy-project-id-by-host']?.[retainedHost]
    });
    console.log(JSON.stringify({ recovered: result.recovered, skipped: result.skipped, apply: process.argv.includes('--apply') }));
    if (!process.argv.includes('--apply') || !result.recovered.length) return;
    const disk = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
    if (JSON.stringify(disk['local-projects']) !== JSON.stringify(activeProjects)) throw Error('Active desktop and source file differ; refusing stale overwrite');
    const backup = `${sourcePath}.before-project-recovery-${Date.now()}`;
    await fs.copyFile(sourcePath, backup);
    await request('set-global-state', { key: 'app-server-project-id-by-legacy-project-id-by-host', value: { ...allMappings, [sourceHost]: result.mappings } });
    await request('set-global-state', { key: 'local-projects', value: result.projects });
    const readback = (await request('get-global-state', { key: 'local-projects' })).value;
    if (!result.recovered.every(project => readback?.[project.id]?.name === project.name)) throw Error('Project recovery readback mismatch');
    console.log(JSON.stringify({ verified: result.recovered.length, backup }));
  } finally { await connection.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
