import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexCliDispatcher, DispatchScheduler } from "../src/dispatcher.mjs";

test("Codex dispatcher resumes the selected thread and sends prompt over stdin", async () => {
  let invocation;
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    let prompt = "";
    child.stdin.on("data", (chunk) => { prompt += chunk.toString(); });
    child.stdin.on("finish", () => queueMicrotask(() => child.emit("close", 0, null)));
    invocation = { command, args, options, prompt: () => prompt };
    return child;
  };
  const dispatcher = new CodexCliDispatcher({ codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex", spawnImpl });
  await dispatcher.dispatch({ targetThreadId: "thread-123", cwd: "/tmp/demo", prompt: "Implement the task" });
  assert.deepEqual(invocation.args, ["exec", "resume", "--skip-git-repo-check", "--json", "thread-123", "-"]);
  assert.equal(invocation.options.cwd, "/tmp/demo");
  assert.equal(invocation.prompt(), "Implement the task");
});

test("Codex dispatcher applies only the selected thread's context override", async () => {
  const invocations = [];
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.on("finish", () => queueMicrotask(() => child.emit("close", 0, null)));
    invocations.push(args);
    return child;
  };
  const contextWindowStore = {
    get(threadId) {
      return threadId === "thread-million" ? { requestedContextWindow: 1_000_000 } : null;
    }
  };
  const dispatcher = new CodexCliDispatcher({ codexPath: "codex", spawnImpl, contextWindowStore });
  await dispatcher.dispatch({ targetThreadId: "thread-million", prompt: "one" });
  await dispatcher.dispatch({ targetThreadId: "thread-default", prompt: "two" });
  assert.deepEqual(invocations[0], ["exec", "resume", "--skip-git-repo-check", "--json", "-c", "model_context_window=1000000", "thread-million", "-"]);
  assert.deepEqual(invocations[1], ["exec", "resume", "--skip-git-repo-check", "--json", "thread-default", "-"]);
});

test("scheduler claims one queued task and records successful completion", async () => {
  const calls = [];
  const store = {
    async promoteDue() { calls.push("promote"); },
    async claimNext() { calls.push("claim"); return { id: "job-1" }; },
    async finish(id, result) { calls.push([id, result]); }
  };
  const scheduler = new DispatchScheduler({ store, dispatcher: { async dispatch(item) { calls.push(["dispatch", item.id]); } } });
  await scheduler.tick();
  assert.deepEqual(calls, ["promote", "claim", ["dispatch", "job-1"], ["job-1", { ok: true }]]);
});
