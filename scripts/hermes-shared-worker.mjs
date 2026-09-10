import readline from 'node:readline';
import fs from 'node:fs/promises';
import { createHermesSharedServices } from '../src/hermes-shared-services.mjs';
const { source, native, catalog, operations } = createHermesSharedServices();
const signatures = new Map();
async function watch({ id }) {
  const item = await source.find(id);
  let file;try { file = await catalog.transcriptPath(item); } catch { return source.history(id); }
  const stat = await fs.stat(file);
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (signatures.get(id) === signature) return null;
  const history = await source.history(id);
  signatures.set(id, signature);
  if (signatures.size > 16) signatures.delete(signatures.keys().next().value);
  return history;
}
const methods = { nativeRead: p => operations.read(p.id), nativeChange: p => operations.change(p.id, p.change), create: p => operations.create(p), watch, interrupt: p => source.interrupt(p.id, p.turnId), list: () => source.list(), history: p => source.history(p.id, p.page),
  send: p => source.send(p.id, p.text, { queued: p.queued === true, attachments: p.attachments }), statuses: async () => Object.fromEntries(await native.readThreadStatuses({ strict: true })) };
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
