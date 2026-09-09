import readline from 'node:readline';
import { createHermesSharedServices } from '../src/hermes-shared-services.mjs';
import { HermesKanbanBridge } from '../src/hermes-kanban-bridge.mjs';
const bridge = new HermesKanbanBridge(createHermesSharedServices());
const methods = new Set(['projects', 'sessions', 'resolve', 'inspect', 'send', 'interrupt', 'open']);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  const { value: line } = await lines[Symbol.asyncIterator]().next();
  if (!line || Buffer.byteLength(line) > 131072) throw new Error('Invalid request size');
  const input = JSON.parse(line);
  if (!methods.has(input.method)) throw new Error('Unsupported method');
  const result = await bridge[input.method](input.params || {});
  const output = JSON.stringify({ result });
  if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new Error('Result exceeds supported size');
  process.stdout.write(output + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error.message || error).slice(0, 500) }) + '\n');
  process.exitCode = 1;
} finally { lines.close(); }
