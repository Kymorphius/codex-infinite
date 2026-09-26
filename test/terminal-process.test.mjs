import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalService } from '../src/terminal-service.mjs';
import { spawnTerminalProcess } from '../src/terminal-process.mjs';

function until(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const untilTime = Date.now() + timeoutMs;
    const check = () => {
      const result = predicate();
      if (result) resolve(result);
      else if (Date.now() >= untilTime) reject(Error('Timed out waiting for terminal output'));
      else setTimeout(check, 20);
    };
    check();
  });
}

test('real PTY handles Unicode, resize, Ctrl-C, reconnect, and descendant cleanup', { skip: process.platform === 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-process-'));
  const service = new TerminalService({ userHome: directory, defaultCwd: directory,
    spawnProcess: options => spawnTerminalProcess({ ...options, env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh', LANG: 'en_US.UTF-8' } }) });
  t.after(async () => { await service.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const session = await service.create({}), frames = [];
  const connection = service.connect(session.id, { send: frame => frames.push(frame), close: () => {} });
  const output = () => frames.filter(frame => frame.type === 'data').map(frame => frame.data).join('');
  // Octal escapes distinguish executed output from the terminal's input echo.
  connection.receive({ type: 'input', data: "stty -echo; printf '\\120\\124\\131_OK:中文\\n'\r" });
  await until(() => output().includes('PTY_OK:中文'));
  connection.receive({ type: 'resize', cols: 111, rows: 37 });
  connection.receive({ type: 'input', data: 'stty size\r' });
  await until(() => output().includes('37 111'));
  connection.receive({ type: 'input', data: "printf '\\102\\105\\107\\111\\116\\n'; sleep 30\r" });
  await until(() => output().includes('BEGIN'));
  const beforeInterrupt = output().length;
  connection.receive({ type: 'input', data: '\x03' });
  await until(() => output().length > beforeInterrupt);
  connection.receive({ type: 'input', data: "printf '\\111\\116\\124\\105\\122\\122\\125\\120\\124\\105\\104\\n'\r" });
  await until(() => output().includes('INTERRUPTED'));
  connection.detach(); const replay = [];
  const reconnected = service.connect(session.id, { send: frame => replay.push(frame), close: () => {} });
  assert.ok(replay[0].replay.includes('PTY_OK:中文'));
  assert.equal(replay[0].session.cols, 111);
  reconnected.receive({ type: 'input', data: "sleep 60 & printf '\\102\\107:%s\\n' $!\r" });
  const backgroundPid = await until(() => replay.filter(frame => frame.type === 'data').map(frame => frame.data).join('').match(/BG:(\d+)/u)?.[1]);
  await service.close(session.id);
  await until(() => { try { process.kill(Number(backgroundPid), 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
  assert.equal(service.list().sessions.length, 0);
});
