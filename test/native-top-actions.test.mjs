import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeTopActionScripts } from '../src/native-top-actions.mjs';
import { installIntoTarget } from '../src/injector.mjs';
import { NativeOwnerInjector } from '../src/native-owner-injector.mjs';

const CWD = '/tmp/wrapper/butler';
const isButler = source => source.includes('data-codex-control-console-butler-entry') && source.includes(JSON.stringify(CWD));

test('top actions add the butler entry only when a butler cwd is configured', () => {
  assert.equal(buildNativeTopActionScripts().length, 1);
  assert.equal(buildNativeTopActionScripts().some(source => source.includes('__cccButlerEntry')), false);
  const scripts = buildNativeTopActionScripts({ butlerCwd: CWD });
  assert.equal(scripts.length, 2); assert.ok(isButler(scripts[1]));
  assert.ok(scripts[0].includes('data-codex-control-console-open-local-project'));
  assert.doesNotThrow(() => new Function(scripts[1]));
});

test('dedicated injector installs the butler at document start and on every sync', async () => {
  const counts = [];
  for (const butlerCwd of ['', CWD]) {
    const calls = [];
    const connection = {
      async send(method, params) { calls.push({ method, source: params?.source || '' }); return {}; },
      async evaluate(source) { calls.push({ method: 'evaluate', source }); return source.includes('document.readyState') ? true : 'document-1'; }
    };
    await installIntoTarget(connection, 'http://127.0.0.1:47831', { butlerCwd, reloadAfterCspBypass: false });
    const early = calls.filter(call => call.method === 'Page.addScriptToEvaluateOnNewDocument');
    counts.push(early.length);
    assert.equal(early.some(call => isButler(call.source)), Boolean(butlerCwd));
    assert.equal(calls.some(call => call.method === 'evaluate' && isButler(call.source)), Boolean(butlerCwd));
  }
  assert.equal(counts[1], counts[0] + 1);
});

test('primary owner injector forwards the butler cwd to both injection phases', async () => {
  const sent = [], evaluated = [];
  const connection = { async connect() {}, async send(method, params) { sent.push(params?.source || ''); }, async evaluate(source) { evaluated.push(source); }, onEvent() { return () => {}; }, async close() {} };
  const injector = new NativeOwnerInjector({ cdpOrigin: 'http://127.0.0.1:9232', butlerCwd: CWD, logger: { warn() {} },
    async discover() { return [{ id: 'primary', webSocketDebuggerUrl: 'ws://primary' }]; }, choose: targets => targets[0], connectionFactory: () => connection });
  await injector.sync();
  assert.ok(sent.some(isButler)); assert.ok(evaluated.some(isButler));
  await injector.stop();
});
