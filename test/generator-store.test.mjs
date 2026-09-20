import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateGeneratorInput } from "../src/generator-contract.mjs";
import { GeneratorStore } from "../src/generator-store.mjs";

function task(overrides = {}) {
  return { action: "existing_thread", title: "检查", prompt: "运行测试", project: "demo", cwd: "/tmp/demo", targetThreadId: "thread-1", targetThreadTitle: "Demo", ...overrides };
}

test("generator validation bounds tasks, destinations, and future trigger time", () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  const item = validateGeneratorInput({ name: "发布流程", scheduledAt: "2026-09-08T11:00:00Z", tasks: [task()] }, { now, taskIdFactory: () => "task-1" });
  assert.equal(item.scheduledAt, "2026-09-08T11:00:00.000Z");
  assert.equal(item.tasks[0].id, "task-1");
  assert.throws(() => validateGeneratorInput({ name: "空", tasks: [] }, { now }), /至少需要一个任务/);
  assert.throws(() => validateGeneratorInput({ name: "过去", scheduledAt: "2026-09-08T09:00:00Z", tasks: [task()] }, { now, taskIdFactory: () => "task" }), /晚于当前时间/);
  assert.throws(() => validateGeneratorInput({ name: "缺少对话", tasks: [task({ targetThreadId: "" })] }, { now, taskIdFactory: () => "task" }), /选择目标对话/);
  assert.equal(validateGeneratorInput({ name: "新会话", tasks: [task({ action: "new_thread", targetThreadId: "" })] }, { now, taskIdFactory: () => "task" }).tasks[0].targetThreadId, null);
});

test("manual request IDs and one-shot due times claim exactly one persisted run", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "generator-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let current = new Date("2026-09-08T10:00:00.000Z");
  let sequence = 0;
  const filePath = path.join(directory, "generators.json");
  const store = new GeneratorStore({ filePath, now: () => current, idFactory: () => `id-${++sequence}` });
  await store.init();
  const generator = await store.create({ name: "发布流程", scheduledAt: "2026-09-08T11:00:00Z", tasks: [task()] });
  const first = await store.claimManual(generator.id, "request-1");
  const repeated = await store.claimManual(generator.id, "request-1");
  assert.equal(repeated.id, first.id);
  assert.equal(store.listRuns().length, 1);

  current = new Date("2026-09-08T11:01:00.000Z");
  assert.equal((await store.claimDue()).length, 1);
  assert.equal((await store.claimDue()).length, 0);
  assert.equal(store.getGenerator(generator.id).scheduleState, "fired");

  const reloaded = new GeneratorStore({ filePath });
  await reloaded.init();
  assert.equal(reloaded.listRuns().length, 2);
  assert.equal(reloaded.getGenerator(generator.id).scheduleState, "fired");
});

test("invalid persisted generator state fails closed without being overwritten", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "generator-corrupt-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "generators.json");
  const original = JSON.stringify({ version: 1, generators: "broken", runs: [] });
  await fs.writeFile(filePath, original);
  const store = new GeneratorStore({ filePath });
  await assert.rejects(store.init(), /状态文件无效/);
  assert.equal(await fs.readFile(filePath, "utf8"), original);
});
