const TERMINAL_DISPATCH_STATUSES = new Set(["sent", "failed", "cancelled", "delivery_unknown"]);

export function generatorRunStatus(run, dispatches = []) {
  if (run.state === "materializing") return "materializing";
  if (!dispatches.length) return "queued";
  if (dispatches.some((item) => item.status === "sending")) return "running";
  if (dispatches.some((item) => !TERMINAL_DISPATCH_STATUSES.has(item.status))) return "queued";
  return dispatches.every((item) => item.status === "sent") ? "completed" : "failed";
}

export class GeneratorService {
  constructor({ store, dispatchStore } = {}) {
    this.store = store;
    this.dispatchStore = dispatchStore;
    this.pendingRuns = new Map();
  }

  async create(input) {
    return this.store.create(input);
  }

  async remove(id) {
    return this.store.remove(id);
  }

  async materialize(run) {
    if (this.pendingRuns.has(run.id)) return this.pendingRuns.get(run.id);
    const pending = (async () => {
      for (const task of run.tasks) {
        const item = await this.dispatchStore.createGenerated({
          ...task,
          actionType: task.action,
          generatorId: run.generatorId,
          generatorName: run.generatorName,
          generatorRunId: run.id,
          generatorTaskId: task.id
        });
        await this.store.attachDispatch(run.id, task.id, item.id);
      }
      return this.store.finishMaterialization(run.id);
    })().finally(() => this.pendingRuns.delete(run.id));
    this.pendingRuns.set(run.id, pending);
    return pending;
  }

  async triggerManual(id, requestId) {
    const run = await this.store.claimManual(id, requestId);
    if (!run) return null;
    await this.materialize(run);
    return run;
  }

  async promoteDue() {
    await this.store.claimDue();
    await this.reconcile();
  }

  async reconcile() {
    const pending = this.store.listRuns().filter((run) => run.state === "materializing");
    for (const run of pending) await this.materialize(run);
  }

  list() {
    const dispatchById = new Map(this.dispatchStore.list().map((item) => [item.id, item]));
    const runs = this.store.listRuns().map((run) => {
      const dispatches = run.dispatches.map((reference) => dispatchById.get(reference.dispatchId)).filter(Boolean);
      return {
        id: run.id,
        generatorId: run.generatorId,
        generatorName: run.generatorName,
        source: run.source,
        triggeredAt: run.triggeredAt,
        materializedAt: run.materializedAt,
        taskCount: run.tasks.length,
        dispatchIds: run.dispatches.map((item) => item.dispatchId),
        status: generatorRunStatus(run, dispatches)
      };
    });
    const generators = this.store.listGenerators().map((generator) => ({
      ...generator,
      tasks: generator.tasks.map(({ cwd: _cwd, prompt: _prompt, ...task }) => task)
    }));
    return { generators, runs };
  }
}
