import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { AppServerProjectOrder } from "../src/app-server-project-order.mjs";

function fakeAppServer(requests) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    let listPage = 0;
    child.stdin = new Writable({
      write(chunk, encoding, callback) {
        const request = JSON.parse(chunk.toString());
        requests.push(request);
        let result = {};
        if (request.method === "project/list") {
          const pages = [
            { data: [{ id: "a", name: "A", position: 0, roots: [{ path: "/a" }] }], nextCursor: "page-2" },
            { data: [{ id: "b", name: "B", position: 1, roots: [{ path: "/b" }] }], nextCursor: null }
          ];
          result = pages[listPage++];
        }
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
        callback();
      }
    });
    child.kill = () => { child.emit("exit", 0); return true; };
    return child;
  };
}

test("app-server ordering pages through projects and uses native move requests", async () => {
  const requests = [];
  const adapter = new AppServerProjectOrder({
    codexPath: "/codex",
    codexHome: "/home",
    spawnImpl: fakeAppServer(requests),
    timeoutMs: 1000
  });
  const result = await adapter.apply([
    { cwd: "/b/repo", createdAt: "2026-08-30T10:00:00Z", updatedAt: "2026-08-30T11:00:00Z", status: "completed" }
  ], new Date("2026-08-30T12:00:00Z"));
  assert.equal(result.changed, true);
  assert.deepEqual(result.order.map((project) => project.id), ["b", "a"]);
  assert.deepEqual(requests.map((request) => request.method), [
    "initialize", "project/list", "project/list", "project/move", "project/move"
  ]);
  assert.deepEqual(requests.slice(-2).map((request) => request.params), [
    { projectId: "a", beforeProjectId: null },
    { projectId: "b", beforeProjectId: "a" }
  ]);
});
