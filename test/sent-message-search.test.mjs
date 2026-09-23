import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { findLatestSentMatch, SentMessageSearchService } from '../src/sent-message-search-service.mjs';
import { buildNativeSentMessageSearchInjectionScript, respondToSentMessageSearch } from '../src/native-sent-message-search.mjs';

test('search reads only real sent messages and returns the latest matching excerpt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sent-search-'));
  const file = path.join(root, 'thread.jsonl');
  const line = (type, payload) => JSON.stringify({ type, payload, timestamp: '2026-09-23T09:00:00Z' });
  try {
    await fs.writeFile(file, [
      line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'secret needle' }] }),
      line('event_msg', { type: 'user_message', message: '# AGENTS.md instructions\nneedle' }),
      line('event_msg', { type: 'user_message', message: '<codex_delegation><source_thread_id>01a04cd6-8d30-78f1-b2a7-f760d148f744</source_thread_id><input>needle</input></codex_delegation>' }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Find my ＮＥＥＤＬＥ project' }] }),
      line('event_msg', { type: 'user_message', message: 'Later needle details' })
    ].join('\n'));
    assert.match((await findLatestSentMatch(file, 'needle')).excerpt, /Later needle details/);
    assert.equal(await findLatestSentMatch(file, 'secret'), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('search skips archived and internal threads, caps results and reports missing history', async () => {
  const read = [];
  const service = new SentMessageSearchService({
    catalog: { async snapshot() { return { truncated: false, conversations: [
      { id: 'one', title: 'One', transcriptPath: '/one', updatedAt: '2026-09-23', archived: false },
      { id: 'old', transcriptPath: '/old', archived: true },
      { id: 'internal', transcriptPath: '/internal', internal: true },
      { id: 'broken', transcriptPath: '/broken' }
    ] }; }, async transcriptPath(item) { if (item.id === 'broken') throw Error('missing'); return item.transcriptPath; } },
    async readMatch(file, query) { read.push([file, query]); return { excerpt: 'needle here', at: '2026-09-23' }; }
  });
  assert.deepEqual(await service.search(''), { items: [], incomplete: false });
  const result = await service.search('ＮＥＥＤＬＥ');
  assert.deepEqual(read, [['/one', 'needle']]);
  assert.equal(result.items[0].id, 'one');
  assert.equal(result.incomplete, true);
});

test('search returns indexed results and progress without rescanning transcripts', async () => {
  const service = new SentMessageSearchService({
    catalog: { async snapshot() { return { truncated: false, conversations: [{ id: 'one', title: 'Fresh title', transcriptPath: '/one' }] }; } },
    index: { sync(items) { assert.equal(items.length, 1); }, async search(query) { assert.equal(query, '项目'); return { items: [{ id: 'one', excerpt: '项目', at: '2026-09-23' }], incomplete: true, progress: { indexed: 1, total: 2, ready: false } }; } },
    async readMatch() { throw new Error('transcript scan should not run'); }
  });
  const result = await service.search('项目');
  assert.equal(result.items[0].title, 'Fresh title');
  assert.deepEqual(result.indexing, { indexed: 1, total: 2, ready: false });
});

test('root search finds user text with full-width letters without matching assistant text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sent-search-roots-'));
  const file = path.join(root, 'thread.jsonl');
  try {
    await fs.writeFile(file, [
      JSON.stringify({ timestamp: '2026-09-22T01:00:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'exclusive assistant' }] } }),
      JSON.stringify({ timestamp: '2026-09-23T01:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Find ＮＥＥＤＬＥ here' }] } })
    ].join('\n'));
    const service = new SentMessageSearchService({ catalog: { sessionRoots: [root], async snapshot() { return { truncated: false, conversations: [{ id: 'one', title: 'One', transcriptPath: file }] }; }, async transcriptPath() { return file; } } });
    assert.equal((await service.search('needle')).items[0].id, 'one');
    assert.deepEqual((await service.search('exclusive')).items, []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native injection compiles and binding returns bounded result to renderer', async () => {
  new vm.Script(buildNativeSentMessageSearchInjectionScript());
  let script;
  await respondToSentMessageSearch(JSON.stringify({ id: 4, query: 'needle' }), { async evaluate(value) { script = value; } },
    { async search() { return { items: [{ id: 'one', title: '<safe>', excerpt: 'needle' }], incomplete: false }; } });
  let received;
  vm.runInNewContext(script, { window: { __codexControlConsoleSentMessageSearch: { receive(value) { received = value; } } } });
  assert.equal(received.id, 4);
  assert.equal(received.items[0].title, '<safe>');
  assert.equal(script.includes('<safe>'), false);
});

test('sidebar and top tab buttons open one panel and a result navigates to its conversation', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.attrs = {}; this.parentElement = null; if (tag === 'input') this.value = ''; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node, before) { node.remove(); const at = before ? this.children.indexOf(before) : -1; this.children.splice(at < 0 ? this.children.length : at, 0, node); node.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    get previousSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    get isConnected() { return Boolean(this.parentElement); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = []; }
    querySelector(selector) { return this.children.find(child => child.tag === selector || (selector === '[data-recent-menu]' && child.attrs['data-recent-menu'] != null)); }
    focus() { this.focused = true; }
  }
  const parent = new Node('div'), projectSearch = new Node('div'), body = new Node('body'), tabBar = new Node('nav');
  projectSearch.className = 'sidebar'; parent.append(projectSearch);
  const recent = new Node('div'); recent.setAttribute('data-recent-menu', 'opened'); tabBar.append(new Node('div'), recent);
  const document = { body, documentElement: parent, querySelector(selector) { return selector === '[data-codex-control-console-project-search]' ? projectSearch : selector === '[data-codex-control-console-native-tabs]' ? tabBar : null; }, createElement: tag => new Node(tag) };
  const routes = [], calls = [], saved = new Map();
  const localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const window = { __codexControlConsoleSearchSentMessages: value => calls.push(JSON.parse(value)), postMessage: value => routes.push(value.path) };
  const context = vm.createContext({ document, window, localStorage, setTimeout: fn => { fn(); return 1; }, clearTimeout() {} });
  vm.runInContext(buildNativeSentMessageSearchInjectionScript(), context);
  const launch = parent.children[1].children[0];
  assert.equal(launch.textContent, '搜索发送内容');
  const topLaunch = tabBar.children[1];
  assert.equal(topLaunch.attrs['aria-label'], '搜索已发送消息');
  assert.equal(tabBar.children[2], recent);
  topLaunch.listeners.click({ currentTarget: topLaunch });
  assert.equal(body.children[0].hidden, false);
  body.children[0].children[0].children[0].children[1].listeners.click();
  launch.listeners.click();
  const panel = body.children[0];
  assert.equal(panel.hidden, false);
  const dialog = panel.children[0], input = dialog.children[1].children[0], historyPanel = dialog.children[3], results = dialog.children[4];
  input.value = 'needle'; input.listeners.input();
  assert.equal(calls[0].query, 'needle');
  window.__codexControlConsoleSentMessageSearch.receive({ id: calls[0].id, items: [{ id: 'one', title: 'Found', excerpt: 'the needle' }], incomplete: false });
  assert.equal(results.children[1].children[1].textContent, 'the needle');
  dialog.children[0].children[1].listeners.click();
  assert.equal(saved.size, 1);
  topLaunch.listeners.click({ currentTarget: topLaunch });
  assert.equal(input.value, '');
  assert.equal(results.children.length, 0);
  assert.equal(historyPanel.children[0].children[0].textContent, '搜索历史');
  assert.equal(historyPanel.children[1].textContent, 'needle');
  historyPanel.children[1].listeners.click();
  assert.equal(input.value, 'needle');
  assert.equal(calls[1].query, 'needle');
  window.__codexControlConsoleSentMessageSearch.receive({ id: calls[1].id, items: [{ id: 'one', title: 'Found', excerpt: 'the needle' }], incomplete: false });
  results.children[1].listeners.click();
  assert.equal(panel.hidden, true);
  assert.deepEqual(routes, ['/local/one']);
  launch.listeners.click({ currentTarget: launch });
  assert.equal(input.value, '');
  historyPanel.children[0].children[1].listeners.click();
  assert.equal(saved.size, 0);
  assert.equal(historyPanel.hidden, true);
  input.value = 'unfinished query';
  parent.children[1].remove();
  topLaunch.remove();
  assert.equal(parent.children.length, 1);
  assert.equal(tabBar.children.includes(topLaunch), false);
  vm.runInContext(buildNativeSentMessageSearchInjectionScript(), context);
  assert.equal(parent.children[1].children[0], launch);
  assert.equal(tabBar.children[1], topLaunch);
  assert.equal(body.children[0], panel);
  assert.equal(input.value, 'unfinished query');
});

test('top search launcher mounts before project search becomes available', () => {
  class Node {
    constructor() { this.children = []; this.style = {}; this.attrs = {}; this.parentElement = null; this.className = ''; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node, before) { node.remove(); const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, node); node.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    get previousSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener() {}
    querySelector(selector) { return this.children.find(child => selector === '[data-recent-menu]' && child.attrs['data-recent-menu'] != null); }
  }
  const parent = new Node(), tabBar = new Node(), body = new Node(), projectSearch = new Node(), recent = new Node();
  projectSearch.className = 'project-search'; recent.setAttribute('data-recent-menu', ''); tabBar.append(recent);
  const document = { body, documentElement: parent, createElement: () => new Node(), querySelector(selector) {
    if (selector === '[data-codex-control-console-native-tabs]') return tabBar;
    if (selector === '[data-codex-control-console-project-search]') return projectSearch.parentElement ? projectSearch : null;
    return null;
  } };
  const context = vm.createContext({ document, window: {}, localStorage: { getItem: () => null } });
  vm.runInContext(buildNativeSentMessageSearchInjectionScript(), context);
  assert.equal(tabBar.children[0].attrs['data-codex-control-console-tab-message-search'], '');
  assert.equal(parent.children.length, 0);
  parent.append(projectSearch);
  vm.runInContext(buildNativeSentMessageSearchInjectionScript(), context);
  assert.equal(parent.children[1].attrs['data-codex-control-console-sent-message-search'], '');
  assert.equal(parent.children[1].className, 'project-search');
});
