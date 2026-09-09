import readline from 'node:readline';
import fs from 'node:fs/promises';
import { getConfig } from '../src/config.mjs';
import { GptContextCatalog } from '../src/gpt-context-catalog.mjs';
import { HermesSharedSource } from '../src/hermes-shared-source.mjs';
import { NativeConversationAdapter } from '../src/native-conversation-adapter.mjs';
import { RemoteMessageService } from '../src/remote-message-service.mjs';
const config = getConfig();
const catalog = new GptContextCatalog({ databasePath: config.threadStateDatabasePath,
  sessionRoots: [config.sessionRoot, config.archivedSessionRoot], titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice });
const native = new NativeConversationAdapter({ cdpOrigin: `http://${config.cdpHost}:${config.cdpPort}` });
const localAdapter = { getTask: async id => (await catalog.snapshot()).conversations.find(item => item.id === id && !item.internal) };
const source = new HermesSharedSource({ catalog, nativeConversationAdapter: native, remoteMessageService: new RemoteMessageService({ localAdapter, nativeConversationAdapter: native }) });
const signatures = new Map();
async function watch({ id }) {
  const item = await source.find(id), file = await catalog.transcriptPath(item), stat = await fs.stat(file);
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (signatures.get(id) === signature) return null;
  const history = await source.history(id);
  signatures.set(id, signature);
  if (signatures.size > 16) signatures.delete(signatures.keys().next().value);
  return history;
}
const methods = { watch, interrupt: p => source.interrupt(p.id, p.turnId), list: () => source.list(), history: p => source.history(p.id, p.page),
  send: p => source.send(p.id, p.text), statuses: async () => Object.fromEntries(await native.readThreadStatuses({ strict: true })) };
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async line => {
  let id;
  try {
    if (Buffer.byteLength(line) > 65536) throw new Error('Shared request too large');
    const input = JSON.parse(line); id = input.id;
    if (!Number.isSafeInteger(id) || typeof input.method !== 'string' || !Object.hasOwn(methods, input.method)) throw new Error('Invalid shared request');
    const result = await methods[input.method](input.params || {});
    const output = JSON.stringify({ id, result });
    if (Buffer.byteLength(output) > 32 * 1024 * 1024) throw new Error('Shared result too large');
    process.stdout.write(output + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id, error: String(error.message || error).slice(0, 500) }) + '\n'); }
});
