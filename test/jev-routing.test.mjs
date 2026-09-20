import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { defaultJevRoutingConfig, normalizeJevRoutingConfig } from "../src/jev-routing-policy.mjs";
import { JevRoutingStore } from "../src/jev-routing-store.mjs";
import { JevRoutingService } from "../src/jev-routing-service.mjs";
import { JevTaskDispatcher } from "../src/jev-task-dispatcher.mjs";
import { createJevRoutingHttpHandler } from "../src/jev-routing-http.mjs";

function processDouble(onInput) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { child.signalCode = "SIGTERM"; child.emit("close", null); };
  let input = "";
  child.stdin.on("data", (chunk) => { input += chunk; onInput?.(input, child); });
  return child;
}

function responseRecorder() {
  return { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
}

function jsonRequest(method, body, origin = "http://127.0.0.1:47831") {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.headers = { origin, "content-type": "application/json" };
  return request;
}

test("routing policy keeps configurable model and effort mappings bounded", () => {
  const defaults = defaultJevRoutingConfig();
  assert.deepEqual(defaults.mappings.critical, { model: "gpt-6-astra", effort: "xhigh" });
  const changed = normalizeJevRoutingConfig({ ...defaults, mappings: { ...defaults.mappings, quick: { model: "gpt-5.6-sol", effort: "max" } } });
  assert.deepEqual(changed.mappings.quick, { model: "gpt-5.6-sol", effort: "max" });
  assert.throws(() => normalizeJevRoutingConfig({ ...defaults, mappings: { ...defaults.mappings, quick: { model: "gpt-5.6-luna", effort: "ultra" } } }), /不支持 Ultra/);
});

test("routing store reads and writes the shared Router document", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-routing-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "codex-router", "jev-task-routing.json");
  const store = new JevRoutingStore({ filePath });
  assert.equal((await store.read()).fallbackTier, "everyday");
  const saved = await store.write({ ...defaultJevRoutingConfig(), minConfidence: 0.8, fallbackTier: "complex" });
  assert.equal(saved.minConfidence, 0.8);
  assert.equal((await store.read()).fallbackTier, "complex");
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
});

test("Jev classification uses stdin and returns the mapped choice", async () => {
  let invocation;
  const service = new JevRoutingService({
    store: { read: async () => defaultJevRoutingConfig() }, jevPath: "/bin/jev", taskDispatcher: {}, exists: () => true,
    spawnImpl(command, args) {
      invocation = { command, args };
      const child = processDouble((input) => {
        if (input === "修复跨模块并发故障") queueMicrotask(() => { child.stdout.end('{"answer":{"choice":"complex","confidence":0.91}}'); child.emit("close", 0); });
      });
      return child;
    }
  });
  const result = await service.classify("修复跨模块并发故障", defaultJevRoutingConfig());
  assert.equal(invocation.command, "/bin/jev");
  assert.deepEqual(result, { tier: "complex", classifiedTier: "complex", confidence: 0.91, fallback: false, reason: "Jev 以 0.91 置信度选择 complex", model: "gpt-5.6-sol", effort: "high" });
  assert.ok(invocation.args.includes("--json"));
});

test("missing Jev falls back without blocking native dispatch", async () => {
  let dispatched;
  const config = { ...defaultJevRoutingConfig(), fallbackTier: "critical" };
  const service = new JevRoutingService({
    store: { read: async () => config }, jevPath: "/missing/jev", exists: () => false,
    taskDispatcher: { async dispatch(input) { dispatched = input; return { threadId: "thread-1", ...input }; } }
  });
  const result = await service.dispatch({ prompt: "重要任务", cwd: "/tmp" });
  assert.equal(result.classification.fallback, true);
  assert.equal(dispatched.model, "gpt-6-astra");
  assert.equal(dispatched.effort, "xhigh");
});

test("native dispatcher starts a durable thread with routed model and effort", async () => {
  const requests = [];
  const dispatcher = new JevTaskDispatcher({
    codexPath: "/bin/codex", codexHome: "/tmp/codex-home", exists: () => true, stat: () => ({ isDirectory: () => true }),
    spawnImpl(command, args, options) {
      assert.equal(command, "/bin/codex"); assert.deepEqual(args, ["app-server"]); assert.equal(options.env.CODEX_HOME, "/tmp/codex-home");
      let consumed = 0;
      const child = processDouble((input) => {
        const lines = input.trim().split("\n");
        for (const line of lines.slice(consumed)) {
          const message = JSON.parse(line); requests.push(message); consumed += 1;
          if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
          if (message.id === 2) child.stdout.write('{"id":2,"result":{"thread":{"id":"native-thread"}}}\n');
          if (message.id === 3) child.stdout.write('{"id":3,"result":{}}\n');
        }
      });
      return child;
    }
  });
  const result = await dispatcher.dispatch({ prompt: "执行", cwd: "/tmp/project", model: "gpt-6-astra", effort: "ultra" });
  assert.equal(result.threadId, "native-thread");
  assert.deepEqual(requests.find((item) => item.id === 2).params, { cwd: "/tmp/project", ephemeral: false, model: "gpt-6-astra", approvalPolicy: "never" });
  assert.equal(requests.find((item) => item.id === 3).params.effort, "ultra");
  dispatcher.close();
});

test("HTTP boundary shares config and protects mutations by exact origin", async () => {
  let current = defaultJevRoutingConfig();
  const service = {
    async snapshot() { return { config: current, available: true }; },
    async update(input) { current = normalizeJevRoutingConfig(input); return current; },
    async dispatch() { return { threadId: "thread-2", model: "gpt-5.6-sol", effort: "high", classification: { tier: "complex" } }; }
  };
  const handler = createJevRoutingHttpHandler({ service, dashboardOrigin: "http://127.0.0.1:47831" });
  const getResponse = responseRecorder();
  await handler({ method: "GET", headers: {} }, getResponse, new URL("http://127.0.0.1:47831/api/jev-routing"));
  assert.equal(getResponse.body.available, true);
  await assert.rejects(handler(jsonRequest("PUT", current, "https://evil.test"), responseRecorder(), new URL("http://127.0.0.1:47831/api/jev-routing")), /精确请求来源/);
  const putResponse = responseRecorder();
  await handler(jsonRequest("PUT", { ...current, fallbackTier: "quick" }), putResponse, new URL("http://127.0.0.1:47831/api/jev-routing"));
  assert.equal(putResponse.body.config.fallbackTier, "quick");
  const dispatchResponse = responseRecorder();
  await handler(jsonRequest("POST", { prompt: "任务", cwd: "/tmp" }), dispatchResponse, new URL("http://127.0.0.1:47831/api/jev-routing/dispatch"));
  assert.equal(dispatchResponse.code, 201);
  assert.equal(dispatchResponse.body.result.threadId, "thread-2");
});
