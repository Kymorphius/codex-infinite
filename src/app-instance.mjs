import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectRestartTarget } from './runtime-restart.mjs';

const execFile = promisify(nodeExecFile);

/** Identity of the running dedicated app: pid plus start time, so a reused pid still differs. */
export function createAppInstanceReader({ config, platform = process.platform, exec = execFile, inspect = inspectRestartTarget, ttlMs = 5000, clock = Date.now } = {}) {
  let cached = null, expiresAt = 0;
  return async function readAppInstance() {
    if (clock() < expiresAt) return cached;
    let instance = null;
    try {
      const target = await inspect(config, { platform, execute: exec });
      if (Number.isInteger(target?.pid) && target.pid > 1) {
        let started = '';
        if (platform === 'darwin') started = String((await exec('/bin/ps', ['-o', 'lstart=', '-p', String(target.pid)])).stdout || '').trim();
        instance = started ? `${target.pid}@${started}` : String(target.pid);
      }
    } catch { instance = null; }
    // Never let a failed lookup clear marks: only a positively read instance replaces the cache.
    if (instance) cached = instance;
    expiresAt = clock() + ttlMs;
    return instance ? cached : null;
  };
}
