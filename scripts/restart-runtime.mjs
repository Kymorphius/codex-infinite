import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfig } from '../src/config.mjs';
import { serviceManagerCommands, assertDedicatedProfile, inspectRestartTarget } from '../src/runtime-restart.mjs';
import { CdpConnection, discoverTargets, chooseMainTarget } from '../src/cdp-client.mjs';
const exec = promisify(nodeExecFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function restartRuntime({ config, serverPid, oldInstance, platform = process.platform, uid = process.getuid?.(),
  execute = exec, wait = sleep, kill = process.kill.bind(process),
  inspect = async () => inspectRestartTarget(config, { platform, execute }),
  recover = waitForPanel } = {}) {
  if (!Number.isInteger(serverPid) || serverPid <= 1 || !/^[0-9a-f-]{36}$/.test(oldInstance || '')) throw Error('Invalid restart identity');
  const commands = serviceManagerCommands(platform, uid);
  await wait(2000);
  await execute(...commands.check);
  const info = await inspect();
  assertDedicatedProfile(info, config, platform);
  if (info) {
    if (platform === 'win32') await execute('taskkill.exe', ['/PID', String(info.pid), '/T', '/F']);
    else {
      kill(info.pid, 'SIGTERM'); await wait(1500);
      const remaining = await inspect();
      assertDedicatedProfile(remaining, config, platform);
      if (remaining?.pid === info.pid) { kill(info.pid, 'SIGKILL'); await wait(500); }
      else if (remaining) throw Error('Dedicated window changed during restart');
    }
  }
  if (platform === 'win32') await execute('taskkill.exe', ['/PID', String(serverPid), '/F']);
  await execute(...commands.restart);
  await recover(config, oldInstance);
}
async function waitForPanel(config, oldInstance) {
  const deadline = Date.now() + 120000;
  let restored = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    let c;
    try {
      const state = await fetch(config.dashboardOrigin + '/api/runtime/status', { signal: AbortSignal.timeout(2000) }).then(r => r.json());
      if (!state.instanceId || state.instanceId === oldInstance) continue;
      c = new CdpConnection(chooseMainTarget(await discoverTargets(config.cdpOrigin)).webSocketDebuggerUrl);
      await c.connect();
      restored = await c.evaluate(`(() => { const entry = document.querySelector('[data-codex-control-console-entry]'); if (!entry) return false; entry.click(); return true; })()`);
      if (restored) break;
    } catch { /* startup may be in progress */ } finally { await c?.close().catch(() => {}); }
  }
  if (!restored) throw Error('Restart recovery timed out');
  console.log(new Date().toISOString(), 'Restart complete; panel restored');
}
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  restartRuntime({ config: getConfig(), serverPid: Number(process.argv[2]), oldInstance: process.argv[3] }).catch(error => {
    console.error(new Date().toISOString(), error.message); process.exitCode = 1;
  });
}
