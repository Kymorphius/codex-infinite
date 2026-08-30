import test from "node:test";
import assert from "node:assert/strict";
import { RemoteMessageService, validateRemoteMessage } from "../src/remote-message-service.mjs";

test("remote messaging validates bounded thread and prompt contracts", () => {
  assert.deepEqual(validateRemoteMessage({ threadId: "thread-1", prompt: "  continue\nnow  " }), { threadId: "thread-1", prompt: "continue\nnow" });
  assert.throws(() => validateRemoteMessage({ threadId: "bad;id", prompt: "go" }), /标识/);
  assert.throws(() => validateRemoteMessage({ threadId: "thread-1", prompt: " " }), /不能为空/);
  assert.throws(() => validateRemoteMessage({ threadId: "thread-1", prompt: "x".repeat(12_001) }), /过长/);
});

test("owner service resumes the local native task and prevents concurrent remote writers", async () => {
  let release;
  const dispatched = [];
  const service = new RemoteMessageService({
    localAdapter: { async getTask(id) { return id === "thread-1" ? { id, cwd: "/work/owner" } : null; } },
    dispatcher: { dispatch(item) { dispatched.push(item); return new Promise((resolve) => { release = resolve; }); } },
    idFactory: () => "request-1",
    logger: { warn() {} }
  });
  const accepted = await service.submit({ threadId: "thread-1", prompt: "continue" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.requestId, "request-1");
  assert.deepEqual(dispatched[0], { targetThreadId: "thread-1", cwd: "/work/owner", prompt: "continue" });
  await assert.rejects(() => service.submit({ threadId: "thread-1", prompt: "again" }), (error) => error.statusCode === 409);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => service.submit({ threadId: "missing", prompt: "go" }), (error) => error.statusCode === 404);
});

