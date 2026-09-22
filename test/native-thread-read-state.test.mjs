import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findNativeReadStateExport, normalizeNativeUnreadIds, readNativeUnreadIds,
  NativeThreadReadStateAdapter } from '../src/native-thread-read-state.mjs';

const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
const second = '01a04cd6-8d30-78f1-b2a7-f760d148f745';
const source = 'atom=binding(scope,()=>owner.read(),({set:update})=>owner.subscribe(()=>update(owner.read())));export{atom as Abc,other as X};';

test('resolves current native read projection without pinning bundle export or variable names', () => {
  assert.equal(findNativeReadStateExport(source), 'Abc');
  assert.equal(findNativeReadStateExport(source.replaceAll('owner', '$a').replaceAll('atom', 'z').replace('Abc', 'xy')), 'xy');
  assert.throws(() => findNativeReadStateExport('export{other as X}'), /binding unavailable/);
  assert.throws(() => findNativeReadStateExport(source + source), /binding unavailable/);
  assert.throws(() => findNativeReadStateExport(source.replace('atom as Abc', 'unrelated as Abc')), /export unavailable/);
  assert.throws(() => findNativeReadStateExport(source.replace('owner.subscribe', 'other.subscribe')), /binding unavailable/);
});

test('normalizes IDs, accepts confirmed empty, rejects absent or malformed native state', () => {
  assert.deepEqual(normalizeNativeUnreadIds([id, id.toUpperCase(), second]), [id, second]);
  assert.deepEqual(normalizeNativeUnreadIds([]), []);
  for (const value of [undefined, null, {}, [null], ['not-a-task'], [id, 3]]) {
    assert.throws(() => normalizeNativeUnreadIds(value), /unavailable/);
  }
});

test('cached native binding reads fresh identity-scoped local state and excludes other hosts', async () => {
  const atom = {}, window = { __codexControlConsoleNativeReadStateBinding: Promise.resolve(atom) };
  let state = { local: [id], remote: [second] };
  const readModel = () => ({ scope: { get(value) { assert.equal(value, atom); return state; } } });
  const context = vm.createContext({ window, document: {}, readModel, normalizeNativeUnreadIds });
  const read = () => vm.runInContext(`(${readNativeUnreadIds.toString()})(readModel, null, normalizeNativeUnreadIds)`, context);
  assert.deepEqual(await read(), [id]);
  state = { local: [], remote: [second] };
  assert.deepEqual(await read(), []);
  // Identity changes replace the native projection; the adapter must not retain
  // IDs from the previous identity or re-read persisted identity buckets.
  state = { local: [second], remote: [id] };
  assert.deepEqual(await read(), [second]);
  state = undefined;
  await assert.rejects(read(), /unavailable/);
  state = { remote: [id] };
  await assert.rejects(read(), /unavailable/);
});

test('binding discovery failure can retry and missing native scope fails closed', async () => {
  const window = { __codexControlConsoleNativeReadStateBinding: Promise.reject(Error('not ready')) };
  const context = vm.createContext({ window, document: {}, readModel: () => ({ scope: null }), normalizeNativeUnreadIds });
  const read = () => vm.runInContext(`(${readNativeUnreadIds.toString()})(readModel, null, normalizeNativeUnreadIds)`, context);
  await assert.rejects(read(), /not ready/);
  assert.equal(Object.hasOwn(window, '__codexControlConsoleNativeReadStateBinding'), false);
  window.__codexControlConsoleNativeReadStateBinding = Promise.resolve({});
  await assert.rejects(read(), /scope unavailable/);
});

test('read-state adapter closes connections on success, invalid responses and transport failure', async () => {
  let value = [id], closed = 0, fail = false;
  const adapter = new NativeThreadReadStateAdapter({ cdpOrigin: 'http://127.0.0.1:9231',
    discover: async origin => { assert.equal(origin, 'http://127.0.0.1:9231'); return [{}]; },
    choose: () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9231/devtools/page/test' }),
    connectionFactory: () => ({ connect: async () => {}, close: async () => { closed++; },
      evaluate: async script => { assert.match(script, /state\?\.local/); if (fail) throw Error('transport failed'); return value; } })
  });
  assert.deepEqual(await adapter.readUnreadIds(), [id]);
  value = undefined;
  await assert.rejects(adapter.readUnreadIds(), /unavailable/);
  fail = true;
  await assert.rejects(adapter.readUnreadIds(), /transport failed/);
  assert.equal(closed, 3);
});

test('read-state adapter rejects missing window instead of reporting no unread tasks', async () => {
  const adapter = new NativeThreadReadStateAdapter({ discover: async () => [], choose: () => null });
  await assert.rejects(adapter.readUnreadIds(), /window unavailable/);
});
