import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/hermes-context-query.mjs', import.meta.url));
function run(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_CONTROL_THREAD_STATE_DB: '/not-a-real-gpt-database.sqlite' } });
    let stdout = '';
    child.stdout.on('data', data => { stdout += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, value: JSON.parse(stdout) }));
    child.stdin.end(input);
  });
}

test('one-shot context query rejects mutation and prototype methods before reading any source', async () => {
  for (const method of ['sendMessage', 'constructor', '__proto__', 'envelope']) {
    const result = await run(JSON.stringify({ method }));
    assert.equal(result.code, 1);
    assert.equal(result.value.error, '不支持的查询。');
  }
});

test('one-shot context query reports malformed, oversized and missing-source failures', async () => {
  assert.equal((await run('{broken')).code, 1);
  assert.equal((await run('x'.repeat(66000))).value.error, '查询参数过长。');
  const result = await run(JSON.stringify({ method: 'listProjects' }));
  assert.equal(result.code, 1);
  assert.match(result.value.error, /无法读取本机/);
});
