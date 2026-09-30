import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalModelPicker } from '../src/native-terminal-model-picker.mjs';
import { NATIVE_TERMINAL_MODEL_PICKER_STYLE } from '../src/native-terminal-model-picker-style.mjs';
import { claudeTerminalCatalog } from '../src/claude-terminal-settings.mjs';

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); } getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { focused = this; }
}
let focused = null;
function setup(record, respond) {
  const requests = [], accepted = [], listeners = new Map(), pageListeners = new Map();
  const window = { __cccTerminalConversations: { accept: value => accepted.push(value) },
    addEventListener: (name, fn) => pageListeners.set(`window:${name}`, fn), removeEventListener: name => pageListeners.delete(`window:${name}`) };
  const document = { createElement: tag => new Node(tag), addEventListener: (name, fn, capture) => pageListeners.set(`document:${name}:${capture}`, fn),
    removeEventListener: (name, fn, capture) => pageListeners.delete(`document:${name}:${capture}`) };
  const context = vm.createContext({ window, document, Promise, Map, Boolean, String, Error });
  vm.runInContext(`${claudeTerminalCatalog.toString()}\n(${installNativeTerminalModelPicker.toString()})()`, context);
  const api = { async request(operation, input) { input = JSON.parse(JSON.stringify(input)); requests.push({ operation, input }); return respond(operation, input); } };
  const root = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const picker = window.__cccCreateNativeTerminalModelPicker({ record, api, root });
  const all = node => [node, ...node.children.filter(child => child instanceof Node).flatMap(all)];
  const find = predicate => picker && all(picker.element).filter(predicate);
  return { picker, requests, accepted, listeners, pageListeners, window, find };
}
const base = { id: 'c1', kind: 'claude', revision: 3, status: 'running', claudeSettings: null, claudeObserved: null, claudeSettingsReadOnly: null };

test('picker shows the stored choice as a native-style pill and saves each change', async () => {
  const saved = [];
  const { picker, requests, accepted, find, listeners } = setup({ ...base, claudeSettings: { model: 'opus', effort: 'high', ultracode: false, updatedAt: 'x' } },
    (operation, input) => { saved.push(input.claudeSettings); return { conversation: { ...base, revision: input.expectedRevision + 1, claudeSettings: { ...input.claudeSettings, updatedAt: 'y' }, claudeSettingsPending: true } }; });
  const [trigger] = find(node => /model-pill/.test(node.className)), [menu] = find(node => node.className === 'model-menu');
  const label = find(node => node.className === 'model-label')[0], note = find(node => node.className === 'model-note')[0];
  assert.equal(label.textContent, 'Opus 5.5 · 高'); assert.equal(trigger.attributes['aria-haspopup'], 'menu'); assert.equal(menu.hidden, true);
  const rows = find(node => node.attributes.role === 'menuitemradio'), efforts = find(node => node.attributes.role === 'radio');
  assert.equal(rows.length, 13); assert.deepEqual(efforts.map(node => node.textContent), ['自动', '轻度', '中', '高', '极高', '最高']);
  assert.ok(find(node => node.textContent === '别名（随 Claude 更新）').length, 'aliases are grouped under their own heading');
  trigger.onclick(); assert.equal(menu.hidden, false); assert.equal(trigger.attributes['aria-expanded'], 'true');
  rows.find(row => row.dataset.model === 'sonnet').onclick(); await tick();
  assert.deepEqual(requests[0], { operation: 'update', input: { id: 'c1', expectedRevision: 3, claudeSettings: { model: 'sonnet', effort: 'high', ultracode: false } } });
  assert.equal(accepted[0].revision, 4); assert.equal(label.textContent, 'Sonnet 5.5 · 高');
  assert.match(note.textContent, /等待 Claude 空闲/);
  picker.element.onkeydown({ key: 'ArrowRight', target: efforts[3], preventDefault() {} }); await tick();
  assert.deepEqual(saved.at(-1), { model: 'sonnet', effort: 'xhigh', ultracode: false }, 'arrow keys move along the effort segments');
  find(node => /ultra/.test(node.className))[0].onclick(); await tick();
  assert.equal(saved.at(-1).ultracode, true); assert.equal(label.textContent, 'Sonnet 5.5 · 极高 · Ultracode');
  rows.find(row => row.dataset.model === 'haiku').onclick(); await tick();
  assert.deepEqual(saved.at(-1), { model: 'haiku', effort: 'auto', ultracode: true }, 'auto-only models force auto');
  assert.equal(efforts[3].disabled, true); assert.equal(efforts[0].disabled, false);
  picker.element.onkeydown({ key: 'Escape', target: rows[0], preventDefault() {}, stopPropagation() {} }); assert.equal(menu.hidden, true); assert.equal(focused, trigger);
  trigger.onclick(); listeners.get('pointerdown')({ composedPath: () => [] }); assert.equal(menu.hidden, true, 'an outside click closes it');
  picker.dispose(); assert.equal(listeners.size, 0);
});

test('a revision conflict reloads and retries once; other errors stay in the menu', async () => {
  let conflicts = 1;
  const { requests, find } = setup(base, (operation, input) => {
    if (operation === 'open') return { conversation: { ...base, revision: 9 } };
    if (conflicts-- > 0) throw Error('会话已变更，请刷新后重试');
    if (input.claudeSettings.effort === 'max') throw Error('磁盘已满');
    return { conversation: { ...base, revision: 10, claudeSettings: { ...input.claudeSettings, updatedAt: 'z' } } };
  });
  assert.equal(find(node => node.className === 'model-label')[0].textContent, 'Claude 默认');
  find(node => node.dataset.effort === 'low')[0].onclick(); await tick();
  assert.deepEqual(requests.map(item => [item.operation, item.input.expectedRevision]), [['update', 3], ['open', undefined], ['update', 9]]);
  assert.deepEqual(requests.at(-1).input.claudeSettings, { model: null, effort: 'low', ultracode: false }, 'no known model stays unset instead of pinning one');
  find(node => node.dataset.effort === 'max')[0].onclick(); await tick();
  const note = find(node => node.className === 'model-note')[0];
  assert.equal(note.textContent, '磁盘已满'); assert.equal(note.attributes['data-tone'], 'bad');
});

test('a conflict retry applies only the clicked change to the refreshed record', async () => {
  let conflicts = 1;
  const stale = { ...base, claudeSettings: { model: 'opus', effort: 'high', ultracode: false, updatedAt: 'a' } };
  const fresh = { ...base, revision: 5, claudeSettings: { model: 'sonnet', effort: 'high', ultracode: false, updatedAt: 'b' } };
  const { requests, find } = setup(stale, (operation, input) => {
    if (operation === 'open') return { conversation: fresh };
    if (conflicts-- > 0) throw Error('会话已变更，请刷新后重试');
    return { conversation: { ...fresh, revision: 6, claudeSettings: { ...input.claudeSettings, updatedAt: 'c' } } };
  });
  find(node => node.dataset.effort === 'max')[0].onclick(); await tick();
  assert.deepEqual(requests.at(-1).input, { id: 'c1', expectedRevision: 5, claudeSettings: { model: 'sonnet', effort: 'max', ultracode: false } },
    'the model read back from Claude is kept');
  assert.equal(find(node => node.className === 'model-label')[0].textContent, 'Sonnet 5.5 · 最高');
});

test('saving keeps the focused control enabled; keys work from the trigger; clicks anywhere outside close', async () => {
  let finish;
  const { picker, find, pageListeners } = setup({ ...base, claudeSettings: { model: null, effort: 'high', ultracode: false, updatedAt: 'x' } },
    (operation, input) => new Promise(resolve => { finish = () => resolve({ conversation: { ...base, revision: 4, claudeSettings: { ...input.claudeSettings, updatedAt: 'y' } } }); }));
  const [trigger] = find(node => /model-pill/.test(node.className)), [menu] = find(node => node.className === 'model-menu');
  assert.equal(find(node => node.className === 'model-label')[0].textContent, 'Claude 默认 · 高');
  trigger.onclick(); assert.equal(menu.hidden, false);
  picker.element.onkeydown({ key: 'Escape', target: trigger, preventDefault() {}, stopPropagation() {} }); assert.equal(menu.hidden, true, 'Escape closes a menu opened by a click');
  picker.element.onkeydown({ key: 'ArrowDown', target: trigger, preventDefault() {} }); assert.equal(menu.hidden, false);
  assert.equal(focused.attributes.role, 'menuitemradio', 'ArrowDown moves into the list');
  const efforts = find(node => node.attributes.role === 'radio');
  picker.element.onkeydown({ key: 'ArrowRight', target: efforts[3], preventDefault() {} }); await tick();
  assert.equal(focused, efforts[4]); assert.equal(efforts[4].disabled, false); assert.equal(efforts[4].attributes['aria-disabled'], 'true');
  picker.element.onkeydown({ key: 'ArrowRight', target: efforts[4], preventDefault() {} }); await tick();
  assert.equal(focused, efforts[4], 'ignored while saving');
  finish(); await tick(); assert.equal(efforts[4].attributes['aria-disabled'], 'false');
  pageListeners.get('document:pointerdown:true')({ composedPath: () => [] }); assert.equal(menu.hidden, true, 'a click on the title bar or sidebar closes it');
  trigger.onclick(); pageListeners.get('window:blur')(); assert.equal(menu.hidden, true);
  picker.dispose(); assert.equal(pageListeners.size, 0);
});

test('shell has no picker; companion and attached sessions are read-only; observed values are shown', () => {
  assert.equal(setup({ ...base, kind: 'shell' }, () => ({})).picker, null);
  const companion = setup({ ...base, claudeSettingsReadOnly: 'companion', claudeObserved: { model: 'opus-latest', effort: 'medium', ultracode: null } }, () => ({}));
  assert.equal(companion.find(node => node.className === 'model-label')[0].textContent, 'Opus 最新 · 中');
  assert.ok(companion.find(node => node.attributes.role === 'menuitemradio').every(row => row.disabled));
  assert.match(companion.find(node => node.className === 'model-note')[0].textContent, /Router/);
  const attached = setup({ ...base, claudeSettingsReadOnly: 'attach' }, () => ({}));
  assert.match(attached.find(node => node.className === 'model-note')[0].textContent, /只读/);
  const elsewhere = setup({ ...base, status: 'stopped', claudeSettingsReadOnly: 'elsewhere' }, () => ({}));
  assert.match(elsewhere.find(node => node.className === 'model-note')[0].textContent, /其他 Claude 进程/);
  assert.ok(elsewhere.find(node => node.attributes.role === 'radio').every(button => button.disabled));
  const stopped = setup({ ...base, status: 'stopped', claudeSettings: { model: 'fable', effort: 'auto', ultracode: false, updatedAt: 'x' } }, () => ({}));
  assert.equal(stopped.find(node => node.className === 'model-label')[0].textContent, 'Fable 5.1 · 自动');
  assert.match(stopped.find(node => node.className === 'model-note')[0].textContent, /下次启动/);
});

test('picker style copies the native menu surface and opens upward', () => {
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-menu\{position:absolute;right:0;bottom:calc\(100% \+ 10px\)/);
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-picker\{[^}]*min-width:0;max-width:min\(280px,42vw\)\}/, 'the width cap is on the shrinkable wrapper');
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-pill\{flex:0 1 auto;max-width:100%;min-width:0/);
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /border-radius:12px;background:var\(--color-surface-elevated,var\(--color-surface,#202022\)\)/);
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /box-shadow:0 14px 42px rgba\(0,0,0,\.28\);backdrop-filter:blur\(22px\)/);
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-row:hover:not\(:disabled\),\.model-row:focus-visible\{background:color-mix\(in srgb,currentColor 9%,transparent\)/);
});

test('where popovers exist the menu opens in the top layer above the pill, sized to the room above', t => {
  const shown = [], proto = Node.prototype;
  Object.assign(proto, { showPopover() { shown.push(['show', this.className]); }, hidePopover() { shown.push(['hide', this.className]); },
    getBoundingClientRect: () => ({ top: 700, right: 1500, height: 24 }), offsetHeight: 20 });
  t.after(() => { for (const key of ['showPopover', 'hidePopover', 'getBoundingClientRect', 'offsetHeight']) delete proto[key]; });
  const { picker, find, window } = setup({ ...base, claudeSettings: { model: 'opus', effort: 'high', ultracode: false, updatedAt: 'x' } }, () => ({}));
  Object.assign(window, { innerWidth: 1800, innerHeight: 900 });
  const [trigger] = find(node => /model-pill/.test(node.className)), [menu] = find(node => node.className === 'model-menu');
  menu.style = {}; assert.equal(menu.attributes.popover, 'manual');
  trigger.onclick();
  assert.deepEqual(shown, [['show', 'model-menu']]);
  // Zoom 1.2 (rendered 24px for a 20px pill): right 300/1.2, bottom (900-700+10)/1.2, max-height min(600, 684)/1.2.
  assert.deepEqual(menu.style, { right: '250.0px', bottom: '175.0px', maxHeight: '500.0px' });
  trigger.onclick(); assert.deepEqual(shown.at(-1), ['hide', 'model-menu']); assert.equal(menu.hidden, true);
  trigger.onclick(); picker.dispose(); assert.deepEqual(shown.at(-1), ['hide', 'model-menu'], 'dispose closes an open popover');
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-menu:popover-open\{position:fixed;inset:auto;margin:0/);
});
