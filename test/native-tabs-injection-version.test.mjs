import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';
import { buildVersionedNativeTabsSource, versionNativeTabsSource } from '../src/native-tabs-injection-version.mjs';
import { buildInjectionScript } from '../src/injection.mjs';

test('the real installer reuses unchanged content and reaches cleanup when its stylesheet changes', () => {
  const before = buildVersionedNativeTabsSource();
  const after = versionNativeTabsSource(buildNativeConversationTabsInjectionSource() + '\n/* changed stylesheet */');
  const version = before.nativeConversationTabsSource.match(/function installNativeConversationTabs\(options\) \{\s+const VERSION = "([^"]+)";/)[1];
  const cleanupReached = new Error('cleanup reached');
  let snapshots = 0, updated;
  const controller = { version, updateOptions(options) { updated = options; },
    snapshot() { snapshots++; return { tabs: ['remembered conversation'] }; },
    destroy() { throw cleanupReached; } };
  const context = vm.createContext({ window: { __codexControlConsoleConversationTabs: controller },
    document: { querySelector: () => ({}), querySelectorAll: () => [] }, options: { mode: 'updated' } });
  const install = (source) => vm.runInContext(`(() => { ${source}\nreturn installNativeConversationTabs(options); })()`, context);
  assert.equal(install(before.nativeConversationTabsSource), controller);
  assert.equal(updated.mode, 'updated');
  assert.equal(snapshots, 0, 'unchanged content skips snapshot/cleanup');
  assert.notEqual(before.digest, after.digest);
  assert.throws(() => install(after.nativeConversationTabsSource), error => error === cleanupReached);
  assert.equal(snapshots, 1, 'the real replacement path captures the previous state before cleanup');
});

test('the real inner and outer installers share the generated source digest', () => {
  const raw = buildNativeConversationTabsInjectionSource();
  const result = buildVersionedNativeTabsSource();
  assert.equal(result.digest, createHash('sha256').update(raw).digest('hex').slice(0, 12));
  assert.deepEqual(buildVersionedNativeTabsSource(), result);
  assert.match(result.nativeConversationTabsSource, new RegExp(`const VERSION = "[^"\\n]+\\.source-${result.digest}";`));
  const injection = buildInjectionScript('http://127.0.0.1:47831');
  assert.ok(injection.includes(result.nativeConversationTabsSource));
  assert.ok(injection.includes(`tabs-${result.digest}.provider-`));
  assert.doesNotThrow(() => new Function(injection));
});

test('a changed installer contract fails closed instead of retaining a stale guard', () => {
  assert.throws(() => versionNativeTabsSource('function unrelated() {}'), /installer version is missing/);
});

test('source versioning changes only the conversation-tabs installer marker', () => {
  const source = "function helper() { const VERSION = 'helper'; }\nfunction installNativeConversationTabs(options) { const VERSION = 'tabs'; }";
  const result = versionNativeTabsSource(source);
  assert.ok(result.nativeConversationTabsSource.includes("const VERSION = 'helper';"));
  assert.ok(result.nativeConversationTabsSource.includes(`const VERSION = "tabs.source-${result.digest}";`));
});
