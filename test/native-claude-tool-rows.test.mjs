import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseClaudeNativeToolNotice, buildNativeClaudeToolRowsInjectionScript } from '../src/native-claude-tool-rows.mjs';

test('only bounded Claude CLI notices become tool activity descriptions', () => {
  assert.deepEqual(parseClaudeNativeToolNotice('Claude 原生工具：Bash · Run checks · npm test（已完成 · 退出码 0）'), {
    name: 'Bash', detail: 'Run checks · npm test', status: '已完成', label: '已运行命令', icon: 'terminal', exitCode: 0,
  });
  assert.equal(parseClaudeNativeToolNotice('Claude 原生工具：Read · /tmp/example.txt（执行中）').label, '正在读取文件 example.txt');
  assert.equal(parseClaudeNativeToolNotice('Claude 原生工具：Edit · src/a.mjs（未成功）').label, '未能修改文件 a.mjs');
  assert.equal(parseClaudeNativeToolNotice('用户说：Claude 原生工具：Bash（已完成）'), null);
  assert.equal(parseClaudeNativeToolNotice('Claude 原生工具：Bash · ' + 'x'.repeat(800) + '（已完成）'), null);
  const truncated = 'x'.repeat(700) + '…';
  assert.equal(parseClaudeNativeToolNotice(`Claude 原生工具：Bash · ${truncated}（执行中）`).detail, truncated);
  assert.equal(parseClaudeNativeToolNotice(`Claude 原生工具：Bash · ${truncated}（已完成 · 退出码 0）`).label, '已运行命令');
  assert.equal(parseClaudeNativeToolNotice('Claude 原生工具：Bash · ' + 'x'.repeat(701) + '（已完成）'), null);
  assert.equal(parseClaudeNativeToolNotice(`Claude 原生工具：Bash · ${truncated}`), null);
});

test('native activity rows merge start and finish without issuing client tool calls', () => {
  const rows = [], sources = [], turn = { getAttribute: () => 'turn:one' };
  function node(tag, value = '') {
    return { tag, dataset: {}, children: [], style: {}, textContent: value, isConnected: true,
      setAttribute(key, entry) { (this.attributes ||= {})[key] = entry; },
      getAttribute(key) { return this.attributes?.[key] || null; },
      append(...items) { this.children.push(...items); },
      before(item) { rows.push(item); },
      closest(selector) { return selector.includes('data-ccc-claude-tool-row') ? null : turn; },
      querySelector(selector) {
        const all = [this, ...this.children.flatMap(child => [child, ...child.children])];
        if (selector === 'pre') return all.find(item => item.tag === 'pre');
        return all.find(item => selector.includes('data-ccc-claude-tool-label') && Object.hasOwn(item.dataset, 'cccClaudeToolLabel'));
      },
    };
  }
  const root = { querySelectorAll: () => sources };
  const document = { documentElement: {}, head: { append() {} }, createElement: tag => node(tag), querySelector: selector => selector.startsWith('style') ? null : root };
  const window = { __codexControlConsoleObserver: true };
  sources.push(node('p', 'Claude 原生工具：Bash · npm test（执行中）'));
  sources.push(node('p', 'ordinary assistant text'));
  const source = buildNativeClaudeToolRowsInjectionScript();
  assert.doesNotMatch(source, /functions\.exec_command|response\.output_item|fetch\(/);
  vm.runInNewContext(source, { document, window, queueMicrotask });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('[data-ccc-claude-tool-label]').textContent, '正在运行命令');
  assert.equal(rows[0].querySelector('pre').textContent, 'npm test');
  assert.equal(sources[0].style.display, 'none');
  assert.equal(sources[1].style.display, undefined);
  sources.push(node('p', 'Claude 原生工具：Bash · npm test（已完成）'));
  window.__cccClaudeToolRows.render();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('[data-ccc-claude-tool-label]').textContent, '已运行命令');
  assert.equal(sources[2].style.display, 'none');
  sources.push(node('p', 'Claude 原生工具：Read · /tmp/file.txt（已完成 · 退出码 0）'));
  window.__cccClaudeToolRows.render();
  assert.equal(rows[1].querySelector('pre').textContent, '/tmp/file.txt\n退出码：0');
  const markdown = node('p', 'Claude 原生工具：Bash · grep x src/.mjs; ps aux | grep -o "port=[0-9]"（已完成）');
  markdown.children.push({ matches: selector => selector.split(',').includes('em') });
  const block = node('div', 'Claude 原生工具：Bash · ls（已完成）');
  block.children.push({ matches: () => false });
  sources.push(markdown, block);
  window.__cccClaudeToolRows.render();
  assert.equal(rows.length, 3);
  assert.equal(markdown.style.display, 'none');
  assert.equal(block.style.display, undefined);
  vm.runInNewContext(source, { document, window, queueMicrotask });
  assert.equal(rows.length, 3);
  // Long CLI commands are truncated by the Router at 700 characters plus ….
  // The streamed source first arrives without its status suffix.
  const long = node('p', 'Claude 原生工具：Bash · ' + 'x'.repeat(700) + '…');
  sources.push(long);
  window.__cccClaudeToolRows.render();
  assert.equal(rows.length, 3);
  long.textContent += '（执行中）';
  window.__cccClaudeToolRows.render();
  assert.equal(rows.length, 4);
  assert.equal(rows[3].querySelector('pre').textContent.length, 701);
  sources.push(node('p', long.textContent.replace('（执行中）', '（已完成 · 退出码 0）')));
  window.__cccClaudeToolRows.render();
  assert.equal(rows.length, 4);
  assert.equal(rows[3].querySelector('[data-ccc-claude-tool-label]').textContent, '已运行命令');
});

test('compact tool-only wrappers including old installed rows without shrinking prose or turn boundaries', () => {
  function node(attrs = {}, children = []) {
    return { children, childNodes: children, style: { getPropertyValue(name) { return this[name]; }, setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }, attrs, textContent: '',
      hasAttribute(name) { return Object.hasOwn(this.attrs, name); },
      getAttribute(name) { return this.attrs[name]; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      matches(selector) { return (this.attrs.class === 'sr-only' && selector.includes('.sr-only')) || Object.keys(this.attrs).some(name => selector.includes(`[${name}]`)); },
      querySelector(selector) { return this.children.find(child => child.matches(selector)) || this.children.map(child => child.querySelector(selector)).find(Boolean); },
    };
  }
  const row = node({ 'data-ccc-claude-tool-row': '' });
  const oldSource = node(); oldSource.style.display = 'none'; oldSource.textContent = 'Claude 原生工具：Bash（已完成）';
  const speaker = node({ class: 'sr-only' }); speaker.textContent = 'Assistant';
  const announcement = node({ hidden: '' }); announcement.textContent = 'tool announcement';
  const wrapper = node({}, [speaker, announcement, node(), node({}, [row, oldSource])]);
  const empty = node({}, [oldSource]);
  const prose = node(); prose.textContent = 'ordinary response';
  const second = node({ 'data-content-search-turn-key': 'message-2' }, [node({ 'data-ccc-claude-tool-row': '' })]);
  const mixed = node({}, [wrapper, second, prose]);
  const root = node({ 'data-turn-key': '' }, [mixed, empty]);
  const style = node();
  const document = { querySelector: selector => selector.startsWith('style') ? style : root, head: { append() {} } };
  let renders = 0;
  const window = { __cccClaudeToolRows: { render() { renders++; } } };
  const script = buildNativeClaudeToolRowsInjectionScript();
  vm.runInNewContext(script, { document, window, getComputedStyle: () => ({ rowGap: '32px' }) });
  assert.equal(wrapper.attrs['data-ccc-claude-tool-container'], 'rows');
  assert.equal(speaker.hasAttribute('data-ccc-claude-tool-container'), false);
  assert.equal(speaker.textContent, 'Assistant');
  assert.equal(announcement.hasAttribute('data-ccc-claude-tool-container'), false);
  assert.equal(empty.attrs['data-ccc-claude-tool-container'], 'empty');
  assert.equal(second.attrs['data-ccc-claude-tool-container'], 'rows');
  assert.equal(second.hasAttribute('data-ccc-claude-tool-adjacent'), true);
  assert.equal(second.style['--ccc-claude-tool-parent-gap'], '32px');
  assert.equal(prose.hasAttribute('data-ccc-claude-tool-adjacent'), false);
  assert.equal(mixed.hasAttribute('data-ccc-claude-tool-container'), false);
  assert.equal(root.hasAttribute('data-ccc-claude-tool-container'), false);
  assert.match(style.textContent, /margin-block:0!important/);
  wrapper.children.push(prose);
  window.__cccClaudeToolRows.compact();
  assert.equal(wrapper.hasAttribute('data-ccc-claude-tool-container'), false);
  assert.equal(second.hasAttribute('data-ccc-claude-tool-adjacent'), false);
  vm.runInNewContext(script, { document, window, getComputedStyle: () => ({ rowGap: '32px' }) });
  assert.equal(window.__codexControlConsoleMutationSubscribers.size, 1);
  assert.equal(renders, 2);
});
