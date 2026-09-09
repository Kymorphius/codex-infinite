import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createGptContextRpc, serveGptContextStdio, GPT_CONTEXT_TOOLS } from '../src/gpt-context-mcp.mjs';

const call = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('MCP discovers only read-only tools and dispatches retrieval', async () => {
  const rpc = createGptContextRpc({ listProjects: async args => ({ query: args.query, projects: [] }) });
  const initialized = await rpc(call('initialize', { protocolVersion: '2025-11-25' }));
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false } });
  const listed = await rpc(call('tools/list'));
  assert.deepEqual(listed.result.tools.map(x => x.name), ['list_projects', 'search_conversations', 'read_conversation']);
  assert.ok(GPT_CONTEXT_TOOLS.every(tool => tool.annotations.readOnlyHint && tool.annotations.destructiveHint === false));
  const result = await rpc(call('tools/call', { name: 'list_projects', arguments: { query: 'current' } }));
  assert.equal(JSON.parse(result.result.content[0].text).query, 'current');
  assert.equal((await rpc(call('tools/call', { name: 'send_message' }))).error.code, -32602);
  assert.equal((await rpc(call('tools/call', { name: '__proto__' }))).error.code, -32602);
  assert.equal((await rpc(call('thread/resume'))).error.code, -32601);
  assert.equal(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('tool errors remain visible instead of returning empty successful results', async () => {
  const rpc = createGptContextRpc({ listProjects: async () => { throw Error('source unavailable'); } });
  const result = await rpc(call('tools/call', { name: 'list_projects' }));
  assert.equal(result.result.isError, true);
  assert.equal(result.result.content[0].text, 'source unavailable');
  assert.equal((await rpc([])).error.code, -32600);
  const large = createGptContextRpc({ listProjects: async () => ({ text: 'x'.repeat(600000) }) });
  assert.equal((await large(call('tools/call', { name: 'list_projects' }))).result.isError, true);
});

test('stdio handles split UTF-8 requests, malformed and oversized input then recovers', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let written = ''; output.on('data', chunk => { written += chunk; });
  const running = serveGptContextStdio({ input, output, dispatch: createGptContextRpc({ listProjects: async args => args }) });
  const message = Buffer.from(JSON.stringify(call('tools/call', { name: 'list_projects', arguments: { query: '中文' } })) + '\n');
  const split = message.indexOf(Buffer.from('中文')) + 1;
  input.write(message.subarray(0, split)); input.write(message.subarray(split));
  input.write('{bad}\n' + 'x'.repeat(70000) + '\n');
  input.end(JSON.stringify(call('ping', {}, 4)) + '\n');
  await running;
  const replies = written.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(JSON.parse(replies[0].result.content[0].text).query, '中文');
  assert.equal(replies[1].error.code, -32700); assert.equal(replies[2].error.code, -32700);
  assert.deepEqual(replies[3], { jsonrpc: '2.0', id: 4, result: {} });
});
