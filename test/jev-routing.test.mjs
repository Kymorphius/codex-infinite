import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { JEV_ROUTE_MODEL_EFFORTS, JEV_ROUTE_MODELS, defaultJevRoutingConfig, normalizeJevRoutingConfig, supportsJevRoute } from "../src/jev-routing-policy.mjs";
import { JEV_MODEL_EFFORTS, JEV_MODELS } from "../public/features/jev-routing/index.js";
import { JevRoutingStore } from "../src/jev-routing-store.mjs";
import { JevThreadRoutingStore, normalizeJevThreadRoutingOverrides } from "../src/jev-thread-routing-store.mjs";
import { JevRoutingService, readJevRoutingReceipts } from "../src/jev-routing-service.mjs";
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

function hybridResponse(choice, confidence, scores = [2, 2, 2, 1, 2, 2]) {
  return JSON.stringify({ answers: {
    tier: { type: "choice", choice, confidence },
    ...Object.fromEntries(["complexity", "scope", "reasoning", "risk", "context", "iteration"].map((name, index) => [name, { type: "score", score: scores[index], confidence: 0.8 }])),
  } });
}

test("an early-exiting Jev process falls back without crashing the enhanced console", async () => {
  const config = defaultJevRoutingConfig();
  const service = new JevRoutingService({ jevPath: process.execPath, exists: () => true,
    spawnImpl: () => spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: ["pipe", "pipe", "pipe"] }) });
  const result = await service.classify("x".repeat(128 * 1024), config);
  assert.equal(result.tier, config.fallbackTier);
  assert.equal(result.source, "fallback");
});

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
  assert.equal(defaults.version, 4);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.transportMode, "router");
  assert.equal(Object.keys(defaults.mappings).length, 8);
  assert.deepEqual(defaults.mappings.instant, { model: "gpt-5.6-luna", effort: "low" });
  assert.deepEqual(defaults.mappings.critical, { model: "gpt-6-astra", effort: "xhigh" });
  assert.deepEqual(defaults.mappings.extreme, { model: "gpt-6-astra", effort: "ultra" });
  const changed = normalizeJevRoutingConfig({ ...defaults, mappings: { ...defaults.mappings, quick: { model: "gpt-5.6-sol", effort: "max" } } });
  assert.deepEqual(changed.mappings.quick, { model: "gpt-5.6-sol", effort: "max" });
  assert.throws(() => normalizeJevRoutingConfig({ ...defaults, mappings: { ...defaults.mappings, quick: { model: "gpt-5.6-luna", effort: "ultra" } } }), /不支持 Ultra/);
  assert.throws(() => normalizeJevRoutingConfig({ ...defaults, transportMode: "proxy-ish" }), /传输方式无效/);
});

test("all locally listed native models are routable with their supported reasoning levels on both settings surfaces", () => {
  assert.deepEqual(JEV_MODELS, JEV_ROUTE_MODELS);
  assert.deepEqual(JEV_MODEL_EFFORTS, JEV_ROUTE_MODEL_EFFORTS);
  for (const [model, effort] of [["gpt-6-luna", "max"], ["gpt-6-sol", "ultra"], ["gpt-6-astra", "ultra"], ["gpt-reserve", "max"], ["gpt-5.5", "xhigh"]]) {
    assert.equal(supportsJevRoute(model, effort), true);
    const defaults = defaultJevRoutingConfig();
    const config = normalizeJevRoutingConfig({ ...defaults, mappings: { ...defaults.mappings, everyday: { model, effort } } });
    assert.deepEqual(config.mappings.everyday, { model, effort });
  }
  assert.equal(supportsJevRoute("gpt-6-luna", "ultra"), false);
  assert.equal(supportsJevRoute("gpt-reserve", "ultra"), false);
  assert.equal(supportsJevRoute("gpt-5.5", "max"), false);
});

test("legacy four-tier config migrates without losing existing mappings", () => {
  const legacy = {
    version: 1,
    minConfidence: 0.83,
    fallbackTier: "critical",
    mappings: {
      quick: { model: "gpt-5.6-luna", effort: "low" },
      everyday: { model: "gpt-5.6-terra", effort: "high" },
      complex: { model: "gpt-5.6-sol", effort: "max" },
      critical: { model: "gpt-6-astra", effort: "ultra" }
    }
  };
  const migrated = normalizeJevRoutingConfig(legacy);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.transportMode, "router");
  assert.equal(Object.keys(migrated.mappings).length, 8);
  for (const tier of ["quick", "everyday", "complex", "critical"]) {
    assert.deepEqual(migrated.mappings[tier], legacy.mappings[tier]);
  }
  assert.deepEqual(migrated.mappings.substantial, { model: "gpt-5.6-terra", effort: "high" });
  assert.deepEqual(migrated.mappings.deep, { model: "gpt-5.6-sol", effort: "xhigh" });
  assert.equal(migrated.fallbackTier, "critical");
});

test("routing store reads and writes the shared Router document", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-routing-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "codex-router", "jev-task-routing.json");
  const store = new JevRoutingStore({ filePath });
  assert.equal((await store.read()).fallbackTier, "everyday");
  const saved = await store.write({ ...defaultJevRoutingConfig(), enabled: false, minConfidence: 0.8, fallbackTier: "complex" });
  assert.equal(saved.minConfidence, 0.8);
  assert.equal((await store.read()).enabled, false);
  assert.equal((await store.read()).fallbackTier, "complex");
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
});

test("per-thread routing overrides persist privately and global changes clear them", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-thread-routing-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "jev-native-thread-routing.json");
  const threadStore = new JevThreadRoutingStore({ filePath });
  const id = "01a0be7e-3c97-76a3-b5da-36c782facc71";
  assert.deepEqual(normalizeJevThreadRoutingOverrides({ overrides: { [id.toUpperCase()]: false, invalid: true } }), { version: 1, overrides: { [id]: false } });
  await threadStore.set(id, false);
  assert.deepEqual((await threadStore.read()).overrides, { [id]: false });
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  let config = defaultJevRoutingConfig();
  const service = new JevRoutingService({ store: { read: async () => config, write: async (value) => (config = normalizeJevRoutingConfig(value)) }, threadStore, exists: () => false });
  assert.equal((await service.snapshot()).threadOverrides[id], false);
  await service.setEnabled(false);
  assert.deepEqual((await service.snapshot()).threadOverrides, {});
});

test("Jev classification uses stdin and returns the mapped choice", async () => {
  let invocation;
  const service = new JevRoutingService({
    store: { read: async () => defaultJevRoutingConfig() }, jevPath: "/bin/jev", taskDispatcher: {}, exists: () => true,
    spawnImpl(command, args) {
      invocation = { command, args };
      const child = processDouble((input) => {
        if (JSON.parse(input).state === "修复跨模块并发故障") queueMicrotask(() => { child.stdout.end(hybridResponse("complex", 0.91)); child.emit("close", 0); });
      });
      return child;
    }
  });
  const result = await service.classify("修复跨模块并发故障", defaultJevRoutingConfig());
  assert.equal(invocation.command, "/bin/jev");
  assert.deepEqual([result.tier, result.classifiedTier, result.confidence, result.lowConfidence, result.source, result.model, result.effort], ["complex", "complex", 0.91, false, "jev", "gpt-5.6-sol", "high"]);
  assert.deepEqual(invocation.args, ["raw"]);
});

test("Windows Jev command wrappers run through cmd.exe", async () => {
  let invocation;
  const service = new JevRoutingService({
    store: { read: async () => defaultJevRoutingConfig() }, jevPath: "C:\\Users\\Admin\\.local\\bin\\jev.cmd", taskDispatcher: {}, exists: () => true, platform: "win32",
    spawnImpl(command, args) {
      invocation = { command, args };
      const child = processDouble(() => queueMicrotask(() => { child.stdout.end(hybridResponse("quick", 0.92)); child.emit("close", 0); }));
      return child;
    }
  });
  assert.equal((await service.classify("quick check", defaultJevRoutingConfig())).fallback, false);
  assert.equal(invocation.command, "cmd.exe");
  assert.deepEqual(invocation.args.slice(0, 4), ["/d", "/s", "/c", '"C:\\Users\\Admin\\.local\\bin\\jev.cmd"']);
});

test("low-confidence Jev choices use six dimensions while invalid results use the fallback", async () => {
  const config = { ...defaultJevRoutingConfig(), fallbackTier: "critical" };
  const lowService = new JevRoutingService({
    store: { read: async () => config }, jevPath: "/bin/jev", taskDispatcher: {}, exists: () => true,
    spawnImpl() {
      const child = processDouble(() => queueMicrotask(() => { child.stdout.end(hybridResponse("deep", 0.18, [3, 3, 3, 3, 3, 3])); child.emit("close", 0); }));
      return child;
    }
  });
  const low = await lowService.classify("难以区分档位的任务", config);
  assert.deepEqual([low.tier, low.classifiedTier, low.confidence, low.lowConfidence, low.source, low.model, low.effort], ["substantial", "deep", 0.18, true, "dimensions", "gpt-5.6-terra", "high"]);

  const failedService = new JevRoutingService({
    store: { read: async () => config }, jevPath: "/bin/jev", taskDispatcher: {}, exists: () => true,
    spawnImpl() {
      const child = processDouble(() => queueMicrotask(() => { child.stdout.end("not-json"); child.emit("close", 2); }));
      return child;
    }
  });
  assert.equal((await failedService.classify("失败任务", config)).fallback, true);
});

test("Jev classification accepts the new intermediate and extreme tiers", async () => {
  const choices = [
    ["substantial", "gpt-5.6-terra", "high"],
    ["deep", "gpt-5.6-sol", "xhigh"],
    ["extreme", "gpt-6-astra", "ultra"]
  ];
  for (const [choice, model, effort] of choices) {
    const service = new JevRoutingService({
      store: { read: async () => defaultJevRoutingConfig() }, jevPath: "/bin/jev", taskDispatcher: {}, exists: () => true,
      spawnImpl() {
        const child = processDouble(() => queueMicrotask(() => { child.stdout.end(hybridResponse(choice, 0.92)); child.emit("close", 0); }));
        return child;
      }
    });
    const result = await service.classify(`route ${choice}`, defaultJevRoutingConfig());
    assert.equal(result.tier, choice);
    assert.equal(result.model, model);
    assert.equal(result.effort, effort);
  }
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

test("router receipts are read back as bounded exact-turn choices", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-routing-receipts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const threadId = "01a0bf0e-f99d-7712-ada7-4a676030e96b";
  const turnId = "01a0bf10-1497-7263-a1ca-4ea079c001de";
  await fs.writeFile(path.join(directory, `${threadId}.json`), JSON.stringify({ threadId, turnId, tier: "deep", model: "gpt-5.6-sol", effort: "high", confidence: 0.88, reason: "router choice", routedAt: "2026-09-21T00:00:00.000Z" }));
  await fs.writeFile(path.join(directory, "not-a-receipt.json"), "{}");
  assert.deepEqual(await readJevRoutingReceipts(directory), [{ threadId, turnId, tier: "deep", model: "gpt-5.6-sol", effort: "high", confidence: 0.88, lowConfidence: false, fallback: false, source: null, dimensionScore: null, dimensionConfidence: null, reason: "router choice", routedAt: "2026-09-21T00:00:00.000Z" }]);
  await fs.writeFile(path.join(directory, `${threadId}.json`), JSON.stringify({ threadId, turnId, tier: "deep", model: "gpt-5.6-sol", effort: "high", source: "inherited" }));
  assert.equal((await readJevRoutingReceipts(directory))[0].source, "inherited");
});

test("receipt snapshot cache refreshes when Router atomically adds a receipt", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-routing-cache-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = defaultJevRoutingConfig();
  const service = new JevRoutingService({ receiptDirectory: directory, store: { async read() { return config; } }, jevPath: process.execPath });
  assert.equal((await service.snapshot()).receipts.length, 0);
  const threadId = "01a0bf0e-f99d-7712-ada7-4a676030e96b";
  const turnId = "01a0bf10-1497-7263-a1ca-4ea079c001de";
  await fs.writeFile(path.join(directory, `${threadId}.json`), JSON.stringify({ threadId, turnId, tier: "deep", model: "gpt-5.6-sol", effort: "high" }));
  assert.equal((await service.snapshot()).receipts[0]?.turnId, turnId);
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
    async snapshot() { return { config: current, available: true, transport: { mode: current.transportMode, runtimeRestartRequired: true } }; },
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
  assert.equal(putResponse.body.transport.runtimeRestartRequired, true);
  const dispatchResponse = responseRecorder();
  await handler(jsonRequest("POST", { prompt: "任务", cwd: "/tmp" }), dispatchResponse, new URL("http://127.0.0.1:47831/api/jev-routing/dispatch"));
  assert.equal(dispatchResponse.code, 201);
  assert.equal(dispatchResponse.body.result.threadId, "thread-2");
});
