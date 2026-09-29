import { MAX_RESTART_MARKS, normalizeRestartMark, reconcileRestartMarks, restartMarkList } from './restart-mark-contract.mjs';

export class RestartMarkService {
  constructor({ store, readAppInstance = async () => null, clock = () => new Date() } = {}) {
    Object.assign(this, { store, readAppInstance, clock });
    this.chain = Promise.resolve();
  }

  #serial(task) {
    const run = this.chain.then(task);
    this.chain = run.catch(() => {});
    return run;
  }

  async #load() {
    const state = await this.store.read();
    const next = reconcileRestartMarks(state, await this.readAppInstance(), this.clock().toISOString());
    return next === state ? state : this.store.write(next);
  }

  snapshot() { return this.#serial(async () => ({ marks: restartMarkList(await this.#load()) })); }

  set({ id, provider, deviceId, title, marked }) {
    return this.#serial(async () => {
      const state = await this.#load();
      const marks = { ...state.marks };
      if (!marked) delete marks[id];
      else {
        const mark = normalizeRestartMark({ ...marks[id], id, provider, deviceId, title, markedAt: marks[id]?.markedAt || this.clock().toISOString() });
        if (!mark) throw new Error('重启需求标记无效');
        if (!marks[id] && Object.keys(marks).length >= MAX_RESTART_MARKS) throw new Error('重启需求标记已达上限');
        marks[id] = mark;
      }
      return { marks: restartMarkList(await this.store.write({ ...state, marks })) };
    });
  }

  // The user's verdict on a converted mark: passed removes it, failed asks for another restart.
  resolve({ id, outcome }) {
    return this.#serial(async () => {
      const state = await this.#load();
      const marks = { ...state.marks };
      if (marks[id]?.status === 'verify') {
        if (outcome === 'passed') delete marks[id];
        else { const { restartedAt, ...rest } = marks[id]; marks[id] = { ...rest, status: 'restart', markedAt: this.clock().toISOString() }; }
      }
      return { marks: restartMarkList(await this.store.write({ ...state, marks })) };
    });
  }
}
