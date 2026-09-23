import { Worker } from 'node:worker_threads';

export class SentMessageIndex {
  constructor({ databasePath, sessionRoots, workerFactory = options => new Worker(new URL('./sent-message-index-worker.mjs', import.meta.url), { ...options, execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')) }), clock = Date.now } = {}) {
    this.clock = clock;
    this.worker = workerFactory({ workerData: { databasePath, sessionRoots } });
    this.progress = { indexed: 0, total: 0, ready: false };
    this.pending = new Map();
    this.nextId = 0;
    this.nextSync = 0;
    this.failed = false;
    this.worker.on('message', message => {
      if (message.type === 'progress') this.progress = { indexed: message.indexed, total: message.total, ready: message.ready };
      if (message.type === 'error') { this.failed = true; this.lastError = message.message; }
      if (message.type === 'searchResult') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve({ ...message, progress: this.progress });
      }
    });
    const fail = error => {
      this.failed = true;
      this.lastError ||= error.message;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
        this.pending.delete(id);
      }
    };
    this.worker.on('error', fail);
    this.worker.on('exit', code => { if (code !== 0) fail(new Error(`sent message index stopped (${code})`)); });
  }

  sync(conversations, { force = false } = {}) {
    if (this.failed || (!force && this.clock() < this.nextSync)) return;
    this.nextSync = this.clock() + 30_000;
    this.progress = { ...this.progress, ready: false };
    this.worker.postMessage({ type: 'sync', items: conversations.map(({ id, transcriptPath }) => ({ id, transcriptPath })) });
  }

  search(query) {
    if (this.failed) return Promise.reject(new Error('sent message index unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sent message index timed out'));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type: 'search', id, query });
    });
  }

  async close() { await this.worker.terminate(); }
}
