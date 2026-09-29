// Shared fake DOM and fixtures for the 讨论 button tests (pairing/forwarding and 新建讨论).
import { installNativeDiscussionButton } from '../../src/native-discussion-button.mjs';
import { createNativeDiscussionStarter } from '../../src/native-discussion-start.mjs';

export const GPT = '00000000-0000-4000-8000-000000000001';
export const CLAUDE = '00000000-0000-4000-8000-000000000002';
export const GPT_NEW = '00000000-0000-4000-8000-0000000000b1';
export const CLAUDE_NEW = '00000000-0000-4000-8000-0000000000b2';
export const PROJECT = { id: 'p1', sourceDirectories: ['/work'] };
export const PAIR = { id: '00000000-0000-4000-8000-0000000000aa', round: 1, titles: { claude: 'Claude 设计', gpt: 'GPT 设计' } };

export class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.style = {}; this.disabled = false; this.hidden = false; this.title = ''; this.className = ''; this.ownText = ''; this.value = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() { this.focused = true; }
  set textContent(value) { this.ownText = String(value); }
  get textContent() { return this.ownText; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
}
export const event = { preventDefault() {}, stopPropagation() {} };
export const tick = () => new Promise(resolve => setTimeout(resolve, 1));

export function setup(tab, responses = {}, { starter = null, project = null, records = [], dom = null } = {}) {
  const body = new El('body'), root = new El('nav'), docListeners = {}, requests = [], commands = [];
  const documentRef = { body, createElement: tag => new El(tag), createElementNS: (_, tag) => new El(tag),
    execCommand: (command, _, value) => { commands.push(command); if (command === 'delete' && !dom?.stuck) dom.editor.innerText = ''; if (command === 'insertText') dom.editor.innerText = value; return true; },
    querySelector: selector => selector.includes('data-codex-composer') ? dom?.editor || null : selector.includes('data-above-composer-conversation-id') ? (dom?.mounted ? new El('div') : null)
      : selector.includes('aria-current="page"') ? dom?.row || null : null,
    querySelectorAll: selector => selector === 'button' && dom?.picker ? [dom.picker] : [],
    addEventListener: (type, fn) => { docListeners[type] = fn; }, removeEventListener: type => { delete docListeners[type]; } };
  globalThis.window = { __cccDiscussions: { request: async (operation, input) => {
    requests.push({ operation, input });
    const value = responses[operation];
    if (value instanceof Error) throw value;
    return typeof value === 'function' ? value(input) : value;
  } } };
  const native = { created: [], claude: [], opened: [], sent: [], keys: [] };
  Object.assign(globalThis.window, {
    __codexControlConsoleProjectSearch: { projectOfTask: () => project, projectOfDirectory: () => project, projectOfKey: key => { native.keys.push(key); return project; } },
    __cccProjectSearchActions: { create: async value => { native.created.push(value); return true; } },
    __cccTerminalConversations: { records: () => records, createRecord: async (...args) => { native.claude.push(args); if (starter?.claudeFails) throw Error('终端服务不可用'); return { id: CLAUDE_NEW, cwd: args[1] }; } },
    __codexControlConsoleOpenTerminalConversation: value => native.opened.push(value.id) });
  const createThreadStarter = starter && (() => Object.assign(async text => { native.sent.push(text); if (starter.sendFails) throw Object.assign(Error('原生发送失败'), { nativeNotSubmitted: starter.notSubmitted === true }); return GPT_NEW; }, { preflight() { if (starter.preflightFails) throw Error('输入框已有内容，请先处理原有草稿'); } }));
  let active = tab;
  const button = installNativeDiscussionButton({ documentRef, root, activeTab: () => active, createThreadStarter, createStarter: createNativeDiscussionStarter });
  const [trigger, menu] = root.children[0].children;
  const texts = () => menu.all().map(node => node.textContent).filter(Boolean);
  const find = text => menu.all().find(node => node.tag === 'button' && node.all().some(child => child.textContent.includes(text)));
  const open = async () => { trigger.listeners.click(event); await tick(); await tick(); };
  return { button, trigger, menu, body, root, docListeners, requests, native, commands, texts, find, open, setActive(value) { active = value; button.update(); } };
}

export const prepared = { gptText: '给 GPT 的话', claudeText: '给 Claude 的话' };
export const startFixture = (overrides = {}, tab = { kind: 'local', id: GPT }, options = {}) => setup(tab, { 'for-conversation': { discussions: [] }, candidates: { role: 'claude', candidates: [] },
  prepare: prepared, begin: { discussion: PAIR, deliveryError: null }, ...overrides }, { starter: {}, project: PROJECT, ...options });
export const startWith = async (f, first, topic = '讨论一下缓存方案') => {
  await f.open();
  f.menu.all().find(node => node.tag === 'textarea').value = topic;
  f.menu.all().find(node => node.dataset.discussStart === first).listeners.click(event);
  for (let i = 0; i < 12; i++) await tick();
};
export const toast = f => f.body.children.map(node => node.textContent);

// The native 新建聊天 page: a composer, no mounted conversation, the project picker and current sidebar row.
export const chatDom = (over = {}) => {
  const editor = new El('div'); editor.innerText = over.text ?? '缓存要不要分层？';
  const attrs = { 'data-app-action-sidebar-project-id': 'local-abc', 'data-app-action-sidebar-project-label': over.rowLabel ?? 'theOne' };
  const row = new El('div'); row.getAttribute = key => attrs[key] ?? null;
  const picker = new El('button'); picker.getAttribute = key => key === 'aria-label' ? (over.picker ?? '更改项目：theOne') : null;
  return { editor, row, picker, mounted: false, ...over.flags };
};
export const chatFixture = (over = {}, options = {}) => setup(options.tab ?? null, { prepare: prepared, begin: { discussion: PAIR, deliveryError: null }, 'for-conversation': { discussions: [] }, candidates: { role: 'gpt', candidates: [] } },
  { starter: {}, project: PROJECT, dom: chatDom(over), ...options.setup });
export const runChat = async (f, first) => {
  await f.open();
  f.menu.all().find(node => node.dataset.discussStart === first).listeners.click(event);
  for (let i = 0; i < 12; i++) await tick();
};
