import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClaudeTitleReader, scanClaudeTitles, claudeTitleText } from '../src/terminal-conversation-title.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';

const line = value => JSON.stringify(value) + '\n';

test('custom title beats generated title, latest wins, other sessions and control characters are ignored', () => {
  const id = randomUUID();
  const text = line({ type: 'ai-title', aiTitle: '旧标题', sessionId: id }) + line({ type: 'ai-title', aiTitle: '新\n标题', sessionId: id })
    + line({ type: 'custom-title', customTitle: '别人的', sessionId: randomUUID() }) + '{broken-title"\n';
  const found = scanClaudeTitles(text, id);
  assert.equal(claudeTitleText(found), '新 标题');
  scanClaudeTitles(line({ type: 'custom-title', customTitle: '我的名字', sessionId: id }), id, found);
  assert.equal(claudeTitleText(found), '我的名字');
  assert.equal(claudeTitleText(scanClaudeTitles('', id)), '');
});

test('title reader follows appended transcript lines and stays inside ~/.claude/projects', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-title-')), id = randomUUID();
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const read = createClaudeTitleReader({ userHome });
  assert.equal(await read(id), '');
  const directory = path.join(userHome, '.claude', 'projects', '-work'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.jsonl`);
  await fs.writeFile(file, line({ type: 'user', sessionId: id }) + line({ type: 'ai-title', aiTitle: '整理侧边栏', sessionId: id }));
  assert.equal(await read(id), '整理侧边栏');
  await fs.appendFile(file, JSON.stringify({ type: 'custom-title', customTitle: '半行', sessionId: id }));
  assert.equal(await read(id), '整理侧边栏', 'an unterminated line is not consumed');
  await fs.appendFile(file, '\n');
  assert.equal(await read(id), '半行');
  await fs.writeFile(file, line({ type: 'ai-title', aiTitle: '重写后', sessionId: id }));
  assert.equal(await read(id), '重写后', 'a truncated file is rescanned');
  await assert.rejects(read('../escape'), { statusCode: 400 });
});

test('Claude conversations with the default title show the transcript title; own titles win', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-title-service-'));
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const titles = new Map();
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTitle: async id => { if (titles.get(id) instanceof Error) throw titles.get(id); return titles.get(id) || ''; } });
  const claude = await service.create({ cwd: directory, kind: 'claude' }), shell = await service.create({ cwd: directory, kind: 'shell' });
  assert.equal(claude.title, 'Claude CLI');
  titles.set(claude.id, '看板会话交互'); titles.set(shell.id, '不应使用');
  const listed = (await service.list()).conversations;
  assert.equal(listed.find(item => item.id === claude.id).title, '看板会话交互');
  assert.equal(listed.find(item => item.id === shell.id).title, '终端');
  assert.equal((await service.open({ id: claude.id })).title, '看板会话交互');
  const renamed = await service.update({ id: claude.id, expectedRevision: claude.revision, title: '我起的名字' });
  assert.equal(renamed.title, '我起的名字');
  titles.set(claude.id, Error('unreadable'));
  const other = await service.create({ cwd: directory, kind: 'claude' }); titles.set(other.id, Error('unreadable'));
  assert.equal((await service.open({ id: other.id })).title, 'Claude CLI', 'unreadable transcript keeps the stored title');
});
