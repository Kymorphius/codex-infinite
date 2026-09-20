import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DispatchBoardStore } from "../src/dispatch-board.mjs";
import { GeneratorStore } from "../src/generator-store.mjs";
import { GeneratorService, generatorRunStatus } from "../src/generator-service.mjs";

function tasks() {
  return [
    { action: "existing_thread", title: "继续", prompt: "继续处理", project: "demo", cwd: "/tmp/demo", targetThreadId: "thread-1", targetThreadTitle: "Demo" },
    { action: "new_thread", title: "新工作", prompt: "开始处理", project: "demo", cwd: "/tmp/demo" }
  ];
}

test("generator service materializes ordered dispatches idempotently and projects run status", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "generator-service-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let sequence = 0;
  const idFactory = () => `id-${++sequence}`;
  const dispatchStore = new DispatchBoardStore({ filePath: path.join(directory, "dispatch.json"), idFactory });
  const store = new GeneratorStore({ filePath: path.join(directory, "generators.json"), idFactory });
  await dispatchStore.init();
  await store.init();
  const service = new GeneratorService({ store, dispatchStore });
  const generator = await service.create({ name: "组合工作", tasks: tasks() });
  const run = await service.triggerManual(generator.id, "request-1");
  await service.triggerManual(generator.id, "request-1");
  assert.equal(store.listRuns().length, 1);
  assert.equal(dispatchStore.list().length, 2);
  assert.deepEqual(dispatchStore.list().toReversed().map((item) => item.generatorTaskId), run.tasks.map((item) => item.id));
  assert.deepEqual(dispatchStore.list().map((item) => item.actionType).sort(), ["existing_thread", "new_thread"]);
  assert.equal(service.list().runs[0].status, "queued");
});

test("reconciliation adopts an already-created run task instead of duplicating it", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "generator-reconcile-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let sequence = 0;
  const idFactory = () => `id-${++sequence}`;
  const dispatchStore = new DispatchBoardStore({ filePath: path.join(directory, "dispatch.json"), idFactory });
  const store = new GeneratorStore({ filePath: path.join(directory, "generators.json"), idFactory });
  await dispatchStore.init();
  await store.init();
  const generator = await store.create({ name: "恢复", tasks: tasks() });
  const run = await store.claimManual(generator.id, "request-recover");
  await dispatchStore.createGenerated({ ...run.tasks[0], actionType: run.tasks[0].action, generatorId: generator.id, generatorName: generator.name, generatorRunId: run.id, generatorTaskId: run.tasks[0].id });
  const service = new GeneratorService({ store, dispatchStore });
  await service.reconcile();
  assert.equal(dispatchStore.list().length, 2);
  assert.equal(store.getRun(run.id).dispatches.length, 2);
  assert.equal(store.getRun(run.id).state, "materialized");
});

test("run projection distinguishes materializing, active, successful, and failed runs", () => {
  assert.equal(generatorRunStatus({ state: "materializing" }), "materializing");
  assert.equal(generatorRunStatus({ state: "materialized" }, [{ status: "sending" }]), "running");
  assert.equal(generatorRunStatus({ state: "materialized" }, [{ status: "sent" }]), "completed");
  assert.equal(generatorRunStatus({ state: "materialized" }, [{ status: "sent" }, { status: "failed" }]), "failed");
});
