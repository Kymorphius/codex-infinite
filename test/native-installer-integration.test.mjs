import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installIntoTarget, NATIVE_INSTALLER_READINESS } from '../src/injector.mjs';
import { NativeOwnerInjector } from '../src/native-owner-injector.mjs';

// Execute cache probes/stamps in a VM; simulate installer side effects without DOM/CDP.
function fixture() {
  let context, failContext = false;
  const calls = [], sent = [];
  function replaceDocument() {
    const document = { previewStyle: false, toolStyle: false, entry: false, paneMounted: true, paneVisible: true, anchorPresent: true, workspace: false,
      getElementById() { return this.previewStyle ? {} : null; },
      querySelector(selector) {
        if (selector.includes('claude-tool-style')) return this.toolStyle ? {} : null;
        if (selector.includes('data-codex-control-console-workspace')) return this.workspace ? {} : null;
        if (selector.includes('app-shell-sidebar') || selector.includes('data-slate-sidebar-content')) return this.paneMounted ? pane : null;
        return this.entry ? {} : null;
      }, querySelectorAll() { return this.anchorPresent ? [anchor] : []; } };
    const pane = { isConnected: true, get style() { return { display: document.paneVisible ? 'block' : 'none' }; },
      closest(selector) { return selector.includes('data-app-navigation-rail') ? null : (selector.includes('sidebar') ? pane : null); } };
    const anchor = { isConnected: true, textContent: 'New chat', parentElement: pane,
      closest(selector) { return selector.includes('data-app-navigation-rail') ? null : (selector.includes('sidebar') ? pane : null); } };
    context = vm.createContext({ window: {}, document });
  }
  replaceDocument();
  const connection = {
    async connect() {}, async close() {}, onEvent() { return () => {}; },
    async send(method, params) { sent.push({ method, params }); return {}; },
    async evaluate(source) {
      calls.push(source);
      if (source.includes('const marker = window.__codexControlConsoleInstallerCache')) return vm.runInContext(source, context);
      if (source.includes('return { hasEntry:')) return { hasEntry: context.document.entry, hasFrame: false };
      if (source.startsWith('window.__codexControlConsoleSetContextOverrides?.')) return vm.runInContext(source, context);
      if (source.startsWith('window.__codexControlConsoleDrainContextActions')) return [];
      const w = context.window;
      if (source.includes('__codexControlConsoleSetContextOverrides = (items)')) {
        if (failContext) { failContext = false; throw Error('interrupted context'); }
        w.__codexControlConsoleNativeContextVersion = 'context';
        w.__codexControlConsoleSetContextOverrides = items => { w.contextItems = items; };
      }
      if (source.includes('__codexControlConsoleReadPendingApprovals = (threadId)')) {
        w.__codexControlConsoleNativeApprovalVersion = 'approval'; w.__codexControlConsoleReadPendingApprovals = () => [];
      }
      if (source.includes('__cccClaudePreviewInstalled = true')) { w.__cccClaudePreviewVersion = 4; context.document.previewStyle = true; }
      if (source.includes('window.__cccClaudeToolRows = {')) { w.__cccClaudeToolRows = { version: 'rows' }; context.document.toolStyle = true; }
      if (source.includes('window.__codexControlConsoleProjectSearch = {')) w.__codexControlConsoleProjectSearch = { version: 'search' };
      if (source.includes('chatgpt26.terminal-inline')) {
        w.__codexControlConsoleInjectionVersion = 'shell'; w.__codexControlConsoleObserver = {};
        context.document.entry = context.document.paneMounted && context.document.paneVisible;
      }
      const stamp = source.lastIndexOf(';(() => { const checks = (');
      if (stamp >= 0) vm.runInContext(source.slice(stamp), context);
    }
  };
  return { connection, calls, sent, replaceDocument, context: () => context,
    failNextContext() { failContext = true; }, reset() { calls.length = 0; sent.length = 0; } };
}

const threadId = '01a05852-9f3a-77b2-8ad3-74aa8e49c7c3';
const dedicatedOptions = { standaloneDashboardBinding: 'dashboard', reloadAfterCspBypass: false };
const hasContextInstaller = source => source.includes('__codexControlConsoleSetContextOverrides = (items)');

test('dedicated warm cycles send fresh snapshots/path menus and prepare runtime without static replay', async t => {
  const f = fixture(); let preparations = 0;
  const options = { ...dedicatedOptions, beforeInjection: async () => { preparations++; },
    contextOverrides: [{ threadId, requestedContextWindow: 32000 }], projectSearch: { projects: [] } };
  await installIntoTarget(f.connection, 'http://127.0.0.1:47831', options);
  const coldBytes = f.calls.reduce((sum, source) => sum + Buffer.byteLength(source), 0);
  assert.ok(vm.runInContext(NATIVE_INSTALLER_READINESS, f.context()).every(Boolean), JSON.stringify(vm.runInContext(NATIVE_INSTALLER_READINESS, f.context())));
  f.reset(); options.contextOverrides = [{ threadId, requestedContextWindow: 64000 }];
  options.projectSearch = { projects: [{ id: 'project-2', name: 'changed project', path: '/tmp/project-2', tasks: [] }] };
  await installIntoTarget(f.connection, 'http://127.0.0.1:47831', options);
  assert.equal(f.calls.some(hasContextInstaller), false);
  assert.equal(f.calls.some(source => source.includes('chatgpt26.terminal-inline')), false);
  assert.equal(f.context().window.__codexControlConsoleClose, undefined);
  assert.equal(f.context().window.contextItems[0].contextWindow, 64000);
  assert.ok(f.calls.some(source => source.includes('/tmp/project-2')));
  assert.equal(preparations, 2);
  assert.equal(f.sent.some(({ method }) => method === 'Page.reload'), false);
  const warmBytes = f.calls.reduce((sum, source) => sum + Buffer.byteLength(source), 0);
  assert.ok(warmBytes < coldBytes / 10);
  t.diagnostic(`dedicated cold ${coldBytes} bytes, warm ${warmBytes} bytes/${f.calls.length} evaluations`);
});

test('native chat without Close and a hidden or unmounted sidebar do not replay the shell', async () => {
  const f = fixture(), install = () => installIntoTarget(f.connection, 'http://127.0.0.1:47831', dedicatedOptions);
  await install();
  assert.equal(f.context().window.__codexControlConsoleClose, undefined);
  for (const mounted of [true, false]) {
    f.context().document.paneMounted = mounted; f.context().document.paneVisible = false;
    f.context().document.entry = false; f.reset(); await install();
    assert.equal(f.calls.some(source => source.includes('chatgpt26.terminal-inline')), false);
  }
  f.context().document.paneMounted = true; f.context().document.paneVisible = true;
  f.context().document.anchorPresent = false; f.reset(); await install();
  assert.equal(f.calls.some(source => source.includes('chatgpt26.terminal-inline')), false);
  f.context().document.anchorPresent = true; f.reset(); await install();
  assert.ok(f.calls.some(source => source.includes('chatgpt26.terminal-inline')));
  assert.equal(f.context().document.entry, true);
});

test('dedicated same-target replacement, missing/versioned components and failed repair recover', async () => {
  const f = fixture(), install = () => installIntoTarget(f.connection, 'http://127.0.0.1:47831', dedicatedOptions);
  await install(); f.replaceDocument(); f.reset(); await install();
  assert.ok(f.calls.some(hasContextInstaller));
  for (const mutate of [() => { delete f.context().window.__codexControlConsoleSetContextOverrides; },
    () => { f.context().document.previewStyle = false; }, () => { f.context().window.__cccClaudeToolRows.version = 'changed'; }]) {
    mutate(); f.reset(); await install(); assert.ok(f.calls.some(hasContextInstaller));
  }
  delete f.context().window.__codexControlConsoleSetContextOverrides;
  f.failNextContext(); await assert.rejects(install(), /interrupted context/);
  f.reset(); await install(); assert.ok(f.calls.some(hasContextInstaller));
  f.context().document.entry = false; f.reset(); await install();
  assert.ok(f.calls.some(source => source.includes('chatgpt26.terminal-inline')));
  f.reset(); await installIntoTarget(f.connection, 'http://127.0.0.1:47832', dedicatedOptions);
  assert.ok(f.calls.some(source => source.includes('chatgpt26.terminal-inline')));
});

test('owner warm cycles retain fresh providers/bindings and recover a replaced document', async t => {
  const f = fixture(); let contextWindow = 32000, reads = 0;
  const injector = new NativeOwnerInjector({ discover: async () => [{ id: 'owner', webSocketDebuggerUrl: 'ws://fake' }],
    choose: targets => targets[0], connectionFactory: () => f.connection, logger: { warn() {} },
    contextWindowStore: { list: () => [{ threadId, requestedContextWindow: contextWindow }] },
    sidebarLabelProvider: { async read() { reads++; return []; } } });
  await injector.sync();
  const coldBytes = f.calls.reduce((sum, source) => sum + Buffer.byteLength(source), 0);
  f.reset(); contextWindow = 64000; await injector.sync();
  assert.equal(f.calls.some(hasContextInstaller), false);
  assert.equal(f.context().window.contextItems[0].contextWindow, 64000);
  assert.equal(reads, 2);
  assert.equal(f.sent.filter(({ method }) => method === 'Runtime.addBinding').length, 4);
  const warmBytes = f.calls.reduce((sum, source) => sum + Buffer.byteLength(source), 0);
  assert.ok(warmBytes < coldBytes / 10);
  t.diagnostic(`owner cold ${coldBytes} bytes, warm ${warmBytes} bytes/${f.calls.length} evaluations`);
  f.replaceDocument(); f.reset(); await injector.sync();
  assert.ok(f.calls.some(hasContextInstaller));
  await injector.stop();
});
