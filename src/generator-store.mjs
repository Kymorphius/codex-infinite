import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { MAX_GENERATORS, MAX_GENERATOR_RUNS, validateGeneratorInput, validateManualRequestId } from "./generator-contract.mjs";

export class GeneratorStore {
  constructor({ filePath, now = () => new Date(), idFactory = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { filePath, now, idFactory });
    this.generators = [];
    this.runs = [];
    this.ready = false;
    this.mutations = Promise.resolve();
  }

  async init() {
    if (this.ready) return;
    let created = false;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.generators) || !Array.isArray(data.runs)) throw new Error("发生器状态文件无效");
      this.generators = data.generators;
      this.runs = data.runs;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      created = true;
    }
    this.ready = true;
    if (created) await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, generators: this.generators, runs: this.runs }, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  mutate(operation) {
    const result = this.mutations.then(operation);
    this.mutations = result.catch(() => {});
    return result;
  }

  listGenerators() {
    return [...this.generators].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  listRuns() {
    return [...this.runs].sort((left, right) => String(right.triggeredAt).localeCompare(String(left.triggeredAt)));
  }

  getGenerator(id) {
    return this.generators.find((item) => item.id === id) || null;
  }

  getRun(id) {
    return this.runs.find((item) => item.id === id) || null;
  }

  async create(input) {
    return this.mutate(async () => {
      if (this.generators.length >= MAX_GENERATORS) throw new Error(`最多保存 ${MAX_GENERATORS} 个发生器`);
      const now = this.now();
      const normalized = validateGeneratorInput(input, { now, taskIdFactory: this.idFactory });
      const timestamp = now.toISOString();
      const generator = {
        id: this.idFactory(), ...normalized,
        scheduleState: normalized.scheduledAt ? "pending" : null,
        createdAt: timestamp, updatedAt: timestamp, lastTriggeredAt: null
      };
      this.generators.push(generator);
      await this.save();
      return generator;
    });
  }

  async remove(id) {
    return this.mutate(async () => {
      const index = this.generators.findIndex((item) => item.id === id);
      if (index < 0) return false;
      this.generators.splice(index, 1);
      await this.save();
      return true;
    });
  }

  newRun(generator, { source, requestId = null }) {
    const triggeredAt = this.now().toISOString();
    const run = {
      id: this.idFactory(), generatorId: generator.id, generatorName: generator.name,
      source, requestId, tasks: structuredClone(generator.tasks), dispatches: [],
      state: "materializing", triggeredAt, materializedAt: null
    };
    generator.lastTriggeredAt = triggeredAt;
    generator.updatedAt = triggeredAt;
    this.runs.unshift(run);
    this.runs = this.runs.slice(0, MAX_GENERATOR_RUNS);
    return run;
  }

  async claimManual(id, rawRequestId) {
    return this.mutate(async () => {
      const requestId = validateManualRequestId(rawRequestId);
      const existing = this.runs.find((run) => run.generatorId === id && run.source === "manual" && run.requestId === requestId);
      if (existing) return existing;
      const generator = this.getGenerator(id);
      if (!generator) return null;
      const run = this.newRun(generator, { source: "manual", requestId });
      await this.save();
      return run;
    });
  }

  async claimDue() {
    return this.mutate(async () => {
      const nowMs = this.now().getTime();
      const claimed = [];
      for (const generator of this.generators) {
        if (generator.scheduleState !== "pending" || !generator.scheduledAt || new Date(generator.scheduledAt).getTime() > nowMs) continue;
        generator.scheduleState = "fired";
        claimed.push(this.newRun(generator, { source: "scheduled" }));
      }
      if (claimed.length) await this.save();
      return claimed;
    });
  }

  async attachDispatch(runId, taskId, dispatchId) {
    return this.mutate(async () => {
      const run = this.getRun(runId);
      if (!run) return null;
      const existing = run.dispatches.find((item) => item.taskId === taskId);
      if (existing) return existing;
      const reference = { taskId, dispatchId };
      run.dispatches.push(reference);
      await this.save();
      return reference;
    });
  }

  async finishMaterialization(runId) {
    return this.mutate(async () => {
      const run = this.getRun(runId);
      if (!run) return null;
      if (run.state !== "materialized") {
        run.state = "materialized";
        run.materializedAt = this.now().toISOString();
        await this.save();
      }
      return run;
    });
  }
}
