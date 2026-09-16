import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DispatchBoardStore } from "../src/dispatch-board.mjs";

function input(title, mode = "queue") {
  return { title, prompt: `执行 ${title}`, project: "demo", targetThreadId: "thread-1", targetThreadTitle: "Demo", mode };
}

test("held messages survive restart and are never claimed automatically", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-held-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  const store = new DispatchBoardStore({ filePath, idFactory: () => "held-1" });
  await store.init();
  const held = await store.create(input("仅待办", "backlog"));
  assert.equal(held.status, "backlog");
  assert.equal(held.queueOrder, null);
  assert.equal(await store.claimNext(), null);

  const reloaded = new DispatchBoardStore({ filePath });
  await reloaded.init();
  assert.equal(reloaded.get("held-1").status, "backlog");
  assert.equal(await reloaded.claimNext(), null);
});

test("queued messages can be reordered persistently and claims follow that order", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-order-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  const ids = ["first", "second", "third"];
  const store = new DispatchBoardStore({ filePath, idFactory: () => ids.shift(), attemptIdFactory: () => "attempt-1" });
  await store.init();
  await store.create(input("第一条"));
  await store.create(input("第二条"));
  await store.create(input("第三条"));
  assert.deepEqual(store.queuedItems().map((item) => [item.id, item.queueOrder]), [["first", 1], ["second", 2], ["third", 3]]);

  await store.moveQueued("third", "up");
  await store.moveQueued("third", "up");
  assert.deepEqual(store.queuedItems().map((item) => item.id), ["third", "first", "second"]);
  assert.equal((await store.moveQueued("third", "up")).queueOrder, 1);

  const reloaded = new DispatchBoardStore({ filePath, attemptIdFactory: () => "attempt-2" });
  await reloaded.init();
  assert.deepEqual(reloaded.queuedItems().map((item) => item.id), ["third", "first", "second"]);
  assert.equal((await reloaded.claimNext()).id, "third");
  assert.deepEqual(reloaded.queuedItems().map((item) => [item.id, item.queueOrder]), [["first", 1], ["second", 2]]);
});

test("legacy queues backfill creation order and queue transitions append or clear order", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-legacy-order-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "board.json");
  const base = { prompt: "执行", project: "demo", targetThreadId: "thread-1", targetThreadTitle: "Demo", scheduledAt: null };
  await fs.writeFile(filePath, JSON.stringify({ version: 2, items: [
    { ...base, id: "later", title: "后创建", status: "queued", createdAt: "2026-09-17T02:00:00.000Z", updatedAt: "2026-09-17T02:00:00.000Z" },
    { ...base, id: "earlier", title: "先创建", status: "queued", createdAt: "2026-09-17T01:00:00.000Z", updatedAt: "2026-09-17T01:00:00.000Z" },
    { ...base, id: "held", title: "待办", status: "backlog", createdAt: "2026-09-17T03:00:00.000Z", updatedAt: "2026-09-17T03:00:00.000Z" }
  ] }));
  const store = new DispatchBoardStore({ filePath });
  await store.init();
  assert.deepEqual(store.queuedItems().map((item) => [item.id, item.queueOrder]), [["earlier", 1], ["later", 2]]);
  assert.equal(store.get("held").queueOrder, null);

  await store.update("held", { status: "queued" });
  assert.equal(store.get("held").queueOrder, 3);
  await store.update("later", { status: "backlog" });
  assert.equal(store.get("later").queueOrder, null);
  assert.deepEqual(store.queuedItems().map((item) => [item.id, item.queueOrder]), [["earlier", 1], ["held", 2]]);
  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).version, 3);
});

test("invalid or non-queued reorder attempts fail closed", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-order-invalid-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DispatchBoardStore({ filePath: path.join(directory, "board.json"), idFactory: () => "held" });
  await store.init();
  await store.create(input("待办", "backlog"));
  await assert.rejects(store.moveQueued("held", "up"), /只有排队中的消息/);
  await assert.rejects(store.moveQueued("held", "sideways"), /方向无效/);
  assert.equal(await store.moveQueued("missing", "up"), null);
});
