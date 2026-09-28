import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalSplit } from '../src/native-terminal-split.mjs';
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.classList = { toggle: (name, value) => { this.split = value; } }; }
  append(...nodes) { this.children.push(...nodes); } replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { width: this.tag === 'aside' ? 420 : 1100 }; }
}
test('split preview opens, selects bounded patch, resizes and closes without terminal input', async () => {
  const storage = new Map(), operations = [], listeners = new Map();
  const context = vm.createContext({ window: {}, document: {
    createElement: tag => new Node(tag), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)
  }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, JSON, Number });
  vm.runInContext(`(${installNativeTerminalSplit.toString()})()`, context);
  const api = { async request(operation, input) { operations.push({ operation, input });
    return operation === 'changes-list' ? { files: [{ name: 'src/a.mjs', added: 2, removed: 1, untracked: false }] } : { patch: '@@ -1 +1 @@\n-old\n+new' };
  } };
  const bar = new Node('header'), output = new Node('terminal');
  const split = context.window.__cccCreateNativeTerminalSplit({ record: { id: 'conversation-a', kind: 'claude', projectRef: null }, bar, output, api });
  assert.equal(split.element.children[0], output);
  const [terminal, divider, review] = split.element.children, toggle = bar.children[0];
  assert.equal(terminal, output); assert.equal(review.hidden, true);
  toggle.onclick(); await tick();
  assert.equal(review.hidden, false); assert.equal(operations.map(value => value.operation).join(','), 'changes-list,changes-file');
  assert.match(review.children[2].children.at(-1).textContent, /\+new/);
  divider.onkeydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(JSON.parse(storage.get('terminal-review:conversation-a')).width, 444);
  divider.onpointerdown({ clientX: 500, preventDefault() {} });
  assert.equal(review.style.width, '444px', 'drag does not resize the PTY during movement');
  listeners.get('pointerup')({ clientX: 460 });
  assert.equal(review.style.width, '460px', 'one resize is committed on release');
  split.command('refresh'); await tick(); assert.equal(operations.filter(value => value.operation === 'changes-list').length, 2);
  split.command('close'); assert.equal(review.hidden, true);
  split.command('open'); await tick(); assert.equal(review.hidden, false);
  review.children[0].children[2].onclick(); assert.equal(review.hidden, true);
  assert.equal(operations.some(value => value.operation === 'input'), false); split.dispose();
});
