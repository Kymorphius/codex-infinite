import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeCached, nativeInstallerSources } from '../src/native-installer-cache.mjs';

function fixture() {
  let context = vm.createContext({ window: {}, document: { style: true } });
  let now = 1000, fail = false;
  const calls = [];
  const connection = { async evaluate(source) {
    calls.push(source);
    if (fail && source.includes('window.module =')) { fail = false; throw Error('interrupted install'); }
    return vm.runInContext(source, context);
  } };
  let builds = 0;
  const options = { key: 'module:v1', now: () => now,
    readiness: '[window.module?.version, typeof window.module?.run === "function", document.style]',
    build: () => { builds++; return 'window.module = { version: "v1", run() {} }; document.style = true;'; } };
  return { connection, options, calls, context: () => context, builds: () => builds, at: value => { now = value; },
    replaceDocument() { context = vm.createContext({ window: {}, document: { style: true } }); }, failNext() { fail = true; } };
}

test('static installers build once and stable warm cycles only send a small probe', async () => {
  const f = fixture();
  assert.deepEqual(await installNativeCached(f.connection, f.options), { installed: true });
  const initial = f.calls[0];
  assert.equal(await vm.runInContext('typeof window.module.run', f.context()), 'function');
  assert.deepEqual(await installNativeCached(f.connection, f.options), { installed: false });
  assert.equal(f.builds(), 1);
  assert.equal(f.calls.length, 2);
  assert.ok(initial.includes('window.module ='));
  assert.equal(f.calls[1].includes('window.module ='), false);
  assert.ok(f.calls[1].includes('marker?.digest'));
});

test('same-connection document replacement, lost module/style and changed version replay immediately', async () => {
  const f = fixture();
  await installNativeCached(f.connection, f.options);
  f.replaceDocument();
  assert.equal((await installNativeCached(f.connection, f.options)).installed, true);
  for (const mutation of ['delete window.module', 'document.style = false', 'window.module.version = "wrong"', 'delete window.module.run']) {
    vm.runInContext(mutation, f.context());
    assert.equal((await installNativeCached(f.connection, f.options)).installed, true);
    assert.equal(vm.runInContext('window.module.version', f.context()), 'v1');
    assert.equal(vm.runInContext('typeof window.module.run', f.context()), 'function');
  }
  assert.equal(f.builds(), 1);
});

test('failed initial and age-bound replay attempts are retried without rebuilding sources', async () => {
  const f = fixture();
  f.failNext();
  await assert.rejects(installNativeCached(f.connection, f.options), /interrupted/);
  assert.equal((await installNativeCached(f.connection, f.options)).installed, true);
  f.at(31000); f.failNext();
  await assert.rejects(installNativeCached(f.connection, f.options), /interrupted/);
  assert.equal((await installNativeCached(f.connection, f.options)).installed, true);
  assert.equal(f.builds(), 1);
});

test('force, config keys, new connections and maximum age preserve bounded recovery', async () => {
  const f = fixture();
  await installNativeCached(f.connection, f.options);
  assert.equal((await installNativeCached(f.connection, { ...f.options, force: true })).installed, true);
  assert.equal((await installNativeCached(f.connection, { ...f.options, key: 'module:v2' })).installed, true);
  assert.equal(f.builds(), 2);
  f.at(30999);
  assert.equal((await installNativeCached(f.connection, f.options)).installed, false);
  f.at(31000);
  assert.equal((await installNativeCached(f.connection, f.options)).installed, true);
  const other = fixture();
  assert.equal((await installNativeCached(other.connection, f.options)).installed, true);
  assert.equal(f.builds(), 3);
});

test('failed warm repair or forced replay invalidates a previous successful marker', async () => {
  for (const force of [false, true]) {
    const f = fixture();
    let fail = false, partTwo = 0;
    const connection = { async evaluate(source) {
      if (source.includes('window.partTwo')) { partTwo++; if (fail) { fail = false; throw Error('second failed'); } }
      return f.connection.evaluate(source);
    } };
    const options = { ...f.options, build: () => ['window.module = {version:"v1",run(){}};', 'window.partTwo = true;'] };
    await installNativeCached(connection, options);
    if (!force) vm.runInContext('delete window.module.run', f.context());
    fail = true;
    await assert.rejects(installNativeCached(connection, { ...options, force }), /second failed/);
    assert.equal(vm.runInContext('typeof window.module.run', f.context()), 'function');
    assert.equal((await installNativeCached(connection, options)).installed, true);
    assert.equal(partTwo, 3);
  }
});

test('document-start construction is reused and partial array installation cannot stamp success', async () => {
  const f = fixture();
  let fail = true;
  const connection = { async evaluate(source) {
    if (source.includes('window.partTwo') && fail) { fail = false; throw Error('second failed'); }
    return f.connection.evaluate(source);
  } };
  let builds = 0;
  const options = { ...f.options, build: () => { builds++; return ['window.partOne = true;', 'window.partTwo = true; window.module = {version:"v1",run(){}};']; } };
  assert.equal(nativeInstallerSources(connection, options.key, options.build).length, 2);
  await assert.rejects(installNativeCached(connection, options), /second failed/);
  assert.equal(vm.runInContext('window.__codexControlConsoleInstallerCache', f.context()), undefined);
  assert.equal((await installNativeCached(connection, options)).installed, true);
  assert.equal(builds, 1);
});

test('failed warm readiness probe invalidates the previous installation', async () => {
  const f = fixture(); let fail = false;
  const connection = { async evaluate(source) {
    if (fail && source.includes('const marker =')) { fail = false; throw Error('probe failed'); }
    return f.connection.evaluate(source);
  } };
  await installNativeCached(connection, f.options); fail = true;
  await assert.rejects(installNativeCached(connection, f.options), /probe failed/);
  assert.equal((await installNativeCached(connection, f.options)).installed, true);
});

test('overlapping installs coalesce and invalid source construction is rejected', async () => {
  const f = fixture();
  await Promise.all([installNativeCached(f.connection, f.options), installNativeCached(f.connection, f.options)]);
  assert.equal(f.builds(), 1);
  assert.equal(f.calls.length, 1);
  await assert.rejects(installNativeCached({}, { key: 'invalid', build: () => [] }), /Invalid native installer/);
});
