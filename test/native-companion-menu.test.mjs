import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installNativeCompanionMenu } from '../src/native-companion-menu.mjs';
import { createRouterCompanionClient, routerCompanionUrl } from '../src/router-companion-client.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { createClaudeCompanionSource } from '../src/claude-companion-source.mjs';
import { terminalCompanionCreateInput } from '../src/terminal-conversation-contract.mjs';

const THREAD = '01a0be7e-3c97-76a3-b5da-36c782facc71', SESSION = '3f610a4b-8878-4713-a824-788bbfce53fb';

function element(attributes = {}) {
  const listeners = {};
  return { attributes, dataset: {}, children: [], parentElement: null, textContent: '', className: '', title: '',
    getAttribute(key) { return this.attributes[key] ?? null; }, setAttribute(key, value) { this.attributes[key] = String(value); },
    append(child) { child.remove(); child.parentElement = this; this.children.push(child); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(value => value !== this); this.parentElement = null; },
    addEventListener(type, listener) { listeners[type] = listener; }, fire(type, event) { listeners[type]?.(event); },
    getBoundingClientRect: () => ({ width: 200 }), closest() { return null; },
    querySelector(selector) { return selector.startsWith('[role="menuitem"]') ? this.children.find(child => child.getAttribute('role') === 'menuitem' && !('cccCompanionMenuItem' in child.dataset)) || null : null; } };
}

function harness(records = []) {
  const listeners = {}, menus = [], escapes = [];
  const documentRef = { body: element(), createElement: () => element(),
    querySelectorAll: selector => (selector === '[role="menu"]' ? menus : []),
    addEventListener: (type, listener) => { listeners[type] = listener; }, removeEventListener: type => { delete listeners[type]; },
    dispatchEvent: event => escapes.push(event.key) };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = callback => callback();
  globalThis.KeyboardEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
  const chosen = [];
  const menu = installNativeCompanionMenu({ documentRef, records: () => records, companion: threadId => chosen.push(threadId) });
  const rightClick = threadId => listeners.contextmenu({ target: { closest: () => (threadId ? { getAttribute: () => 'local:' + threadId } : null) } });
  const open = () => { const node = element({ role: 'menu', 'data-state': 'open' }); const native = element({ role: 'menuitem' }); native.className = 'native-item'; node.append(native); menus.push(node); return node; };
  return { menu, rightClick, open, chosen, escapes, menus };
}

test('right-clicking a Codex thread adds one create item to the menu that opens, styled like native items', () => {
  const h = harness(), node = (h.rightClick(THREAD), h.open());
  h.menu.place(); h.menu.place();
  const added = node.children.filter(child => 'cccCompanionMenuItem' in child.dataset);
  assert.equal(added.length, 1); assert.equal(added[0].textContent, '新建伴生 Claude 会话'); assert.equal(added[0].className, 'native-item');
  added[0].fire('click', { preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.chosen, [THREAD]); assert.deepEqual(h.escapes, ['Escape']);
  assert.equal(node.children.length, 1, 'the item leaves the menu once chosen');
  h.menu.dispose();
});

test('an existing companion is offered as open; other context menus and late menus get nothing', () => {
  const h = harness([{ companionOf: THREAD, archived: false }]);
  h.rightClick(THREAD); const node = h.open(); h.menu.place();
  assert.equal(node.children.at(-1).textContent, '打开伴生 Claude 会话');
  const other = harness(); other.rightClick(null); const plain = other.open(); other.menu.place();
  assert.equal(plain.children.length, 1, 'a right-click outside thread rows adds nothing');
});

test('the service asks Router to create the companion, then returns the adopted record', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-create-')), home = path.join(root, 'home');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(home);
  const terminalService = new TerminalService({ userHome: home, defaultCwd: home });
  t.after(() => terminalService.dispose());
  const calls = [];
  const companionCreator = { async create(threadId) {
    calls.push(threadId);
    const directory = path.join(root, 'claude-companions', threadId);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify({ version: 1, threadId, sessionId: SESSION, state: 'complete' }));
    return { sessionId: SESSION, created: true };
  } };
  const occupancy = async () => null; occupancy.all = async () => [];
  const service = new TerminalConversationService({ terminalService, deviceId: 'test-device', filePath: path.join(root, 'registry.json'),
    companions: createClaudeCompanionSource({ routerStateDirectory: root }), companionCreator, claudeOccupancy: occupancy,
    claudeTranscripts: { summary: async () => ({ title: '', lastUserMessageAt: null, ids: [SESSION] }), search: async () => null } });
  const record = await service.createCompanion(terminalCompanionCreateInput({ threadId: THREAD.toUpperCase() }));
  assert.equal(record.id, SESSION); assert.equal(record.companionOf, THREAD); assert.deepEqual(calls, [THREAD]);
  assert.throws(() => terminalCompanionCreateInput({ threadId: THREAD, extra: 1 }));
  const disabled = new TerminalConversationService({ terminalService, deviceId: 'test-device', filePath: path.join(root, 'other.json') });
  assert.throws(() => disabled.createCompanion({ threadId: THREAD }), error => error.statusCode === 503);
});

test('the Router client stays on loopback, keeps the secret out of errors, and maps Router failures', async () => {
  const secret = 'a'.repeat(40);
  assert.equal(routerCompanionUrl('http://127.0.0.1:4202', secret), `http://127.0.0.1:4202/_codex-router/${secret}/v1/claude-companions/create`);
  assert.throws(() => routerCompanionUrl('http://example.com:4202', secret), error => error.statusCode === 503);
  assert.throws(() => routerCompanionUrl('http://127.0.0.1:4202', 'short'), error => error.statusCode === 503 && !error.message.includes('short'));
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const client = fetchImpl => createRouterCompanionClient({ origin: 'http://127.0.0.1:4202', callerSecretPath: '/secret', readFile: async () => secret + '\n', fetchImpl });
  assert.deepEqual(await client(reply(200, { sessionId: SESSION.toUpperCase(), created: true })).create(THREAD), { sessionId: SESSION, created: true });
  await assert.rejects(client(reply(404, { error: { message: '找不到这个 Codex 会话的本地记录' } })).create(THREAD), error => error.statusCode === 404 && /本地记录/.test(error.message));
  await assert.rejects(client(reply(500, {})).create(THREAD), error => error.statusCode === 502);
  await assert.rejects(client(async () => { throw new Error('ECONNREFUSED'); }).create(THREAD), error => error.statusCode === 503);
});
