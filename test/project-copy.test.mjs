import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeWindowsSourcePath, validateProjectCopySelection } from "../src/project-copy-contract.mjs";
import { ProjectCopyService } from "../src/project-copy-service.mjs";
import { createProjectCopyHttpHandler } from "../src/project-copy-http.mjs";
import { createProjectCopyControl } from "../public/features/sessions/project-copy.js";

test("project copy selections normalize Windows extended paths and constrain local roots", () => {
  assert.equal(normalizeWindowsSourcePath("\\\\?\\D:\\333.开发\\真仙幸存者"), "D:\\333.开发\\真仙幸存者");
  assert.deepEqual(validateProjectCopySelection({
    deviceId: "windows-pc",
    sourceDirectory: "\\\\?\\D:\\333.开发\\真仙幸存者",
    destinationDirectory: "/work/copies/真仙幸存者"
  }, { allowedRoots: ["/work/copies"] }), {
    deviceId: "windows-pc",
    sourceDirectory: "D:\\333.开发\\真仙幸存者",
    destinationDirectory: "/work/copies/真仙幸存者"
  });
  assert.throws(() => validateProjectCopySelection({ deviceId: "windows-pc", sourceDirectory: "D:\\project", destinationDirectory: "/tmp/project" }, { allowedRoots: ["/work/copies"] }), /允许/);
  assert.throws(() => normalizeWindowsSourcePath("relative\\project"), /绝对路径/);
});

test("project copy stages, verifies, and promotes without changing the source selection", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-copy-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "copied-project");
  const body = Buffer.from("hello project\n");
  const sourceRaw = "\\\\?\\D:\\333.开发\\真仙幸存者";
  const manifest = {
    sourceDirectory: "D:\\333.开发\\真仙幸存者",
    rootEntries: [{ name: "README.md", directory: false }],
    files: [{ path: "README.md", bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") }],
    fileCount: 1, directoryCount: 0, bytes: body.length
  };
  const calls = [];
  const sourceThreadId = "11111111-1111-4111-8111-111111111111";
  const copyAdapter = {
    peer: { id: "windows-pc" },
    async preflight(source, exclusions) { calls.push(["preflight", source, exclusions]); return manifest; },
    async preflightSessions(ids) { assert.deepEqual(ids, [sourceThreadId]); return { sessions: [{ sourceThreadId, fullPath: "C:\\session.jsonl", bytes: 7 }], bytes: 7 }; },
    async download(_manifest, staging) { calls.push(["download", staging]); await fs.mkdir(staging); await fs.writeFile(path.join(staging, "README.md"), body); },
    async downloadSessions(_manifest, staging) { await fs.mkdir(staging); await fs.writeFile(path.join(staging, `${sourceThreadId}.jsonl`), "session"); }
  };
  const receipts = [];
  const service = new ProjectCopyService({
    allowedRoots: [root], copyAdapters: [copyAdapter],
    nativeImporter: { async import() { return { projectId: "local-project", conversations: [{ sourceThreadId, localThreadId: "22222222-2222-4222-8222-222222222222" }] }; } },
    receiptStore: { async append(item) { receipts.push(item); } },
    taskAdapter: { async listTasks() { return { tasks: [{ id: sourceThreadId, title: "任务 11111111", cwd: sourceRaw, project: "真仙幸存者", status: "completed", device: { id: "windows-pc", kind: "remote-codex" } }] }; } }
  });
  const sourceSelection = "d:\\333.开发\\真仙幸存者";
  const preflight = await service.preflight({ deviceId: "windows-pc", sourceDirectory: sourceSelection, destinationDirectory: destination });
  assert.equal(preflight.fileCount, 1);
  assert.deepEqual(preflight.excluded, ["target"]);
  const result = await service.execute({ deviceId: "windows-pc", sourceDirectory: sourceSelection, destinationDirectory: destination, preflightToken: preflight.token });
  assert.equal(result.verified, true);
  assert.equal(result.conversationCount, 1);
  assert.equal(await fs.readFile(path.join(destination, "README.md"), "utf8"), body.toString());
  assert.equal(calls[0][1], "d:\\333.开发\\真仙幸存者");
  assert.equal((await fs.readdir(root)).some((name) => name.includes(".codex-copy-")), false);
  assert.deepEqual(receipts.map((item) => item.status), ["importing", "completed"]);
});

test("project verification is independent of Windows and macOS sort order", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-copy-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRaw = "D:\\project";
  const contents = new Map([["z.txt", "z"], [".hidden", "hidden"]]);
  const files = Array.from(contents, ([file, body]) => ({ path: file, bytes: Buffer.byteLength(body), sha256: crypto.createHash("sha256").update(body).digest("hex") })).reverse();
  const adapter = {
    peer: { id: "windows-pc" },
    async preflight() { return { sourceDirectory: sourceRaw, rootEntries: [], files, fileCount: 2, directoryCount: 0, bytes: 7 }; },
    async preflightSessions() { return { sessions: [], bytes: 0 }; },
    async download(_manifest, staging) { await fs.mkdir(staging); for (const [file, body] of contents) await fs.writeFile(path.join(staging, file), body); },
    async downloadSessions(_manifest, staging) { await fs.mkdir(staging); }
  };
  const service = new ProjectCopyService({ allowedRoots: [root], copyAdapters: [adapter], nativeImporter: { async import() { return { projectId: "p", conversations: [] }; } }, taskAdapter: { async listTasks() { return { tasks: [{ id: "11111111-1111-4111-8111-111111111111", cwd: sourceRaw, status: "completed", device: { id: "windows-pc", kind: "remote-codex" } }] }; } } });
  const selection = { deviceId: "windows-pc", sourceDirectory: sourceRaw, destinationDirectory: path.join(root, "copy") };
  const preflight = await service.preflight(selection);
  assert.equal((await service.execute({ ...selection, preflightToken: preflight.token })).verified, true);
});

test("session completion tolerates only a refreshed Git index in an existing copy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-copy-existing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "copy");
  await fs.mkdir(path.join(destination, ".git"), { recursive: true });
  await fs.writeFile(path.join(destination, "README.md"), "same");
  await fs.writeFile(path.join(destination, ".git", "index"), "local cache");
  const hash = (body) => crypto.createHash("sha256").update(body).digest("hex");
  const manifest = {
    sourceDirectory: "D:\\project", rootEntries: [], directoryCount: 1,
    files: [
      { path: "README.md", bytes: 4, sha256: hash("same") },
      { path: ".git/index", bytes: 12, sha256: hash("remote cache") }
    ],
    fileCount: 2, bytes: 16
  };
  const adapter = {
    peer: { id: "windows-pc" }, async preflight() { return manifest; },
    async preflightSessions() { return { sessions: [], bytes: 0 }; },
    async downloadSessions(_manifest, staging) { await fs.mkdir(staging); }
  };
  const service = new ProjectCopyService({
    allowedRoots: [root], copyAdapters: [adapter],
    nativeImporter: { async import() { return { projectId: "p", conversations: [] }; } },
    taskAdapter: { async listTasks() { return { tasks: [{ id: "11111111-1111-4111-8111-111111111111", cwd: "D:\\project", status: "completed", device: { id: "windows-pc", kind: "remote-codex" } }] }; } }
  });
  const selection = { deviceId: "windows-pc", sourceDirectory: "D:\\project", destinationDirectory: destination };
  const preflight = await service.preflight(selection);
  assert.equal(preflight.existingDestination, true);
  assert.equal((await service.execute({ ...selection, preflightToken: preflight.token })).verified, true);
  await fs.writeFile(path.join(destination, "README.md"), "nope");
  await assert.rejects(service.preflight(selection), /内容与远端项目不一致/);
});

test("project copy rejects indexed-path mismatches and existing destinations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-copy-guard-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new ProjectCopyService({
    allowedRoots: [root], copyAdapters: [{ peer: { id: "windows-pc" }, async preflight() { throw new Error("should not run"); } }],
    taskAdapter: { async listTasks() { return { tasks: [] }; } }
  });
  await assert.rejects(service.preflight({ deviceId: "windows-pc", sourceDirectory: "D:\\private", destinationDirectory: path.join(root, "copy") }), /当前可见/);
});

test("project copy HTTP requires the exact mutation origin", async () => {
  const handler = createProjectCopyHttpHandler({ service: { options: () => ({ destinationRoots: ["/work"] }) }, dashboardOrigin: "http://127.0.0.1:47831" });
  const response = { headersSent: false, writeHead(code) { this.code = code; }, end(body) { this.body = body; } };
  await assert.rejects(handler({ method: "POST", headers: { origin: "http://evil", "content-type": "application/json" } }, response, new URL("http://localhost/api/project-copy/preflight")), /精确/);
  const optionsResponse = { writeHead(code) { this.code = code; }, end(body) { this.body = body; } };
  assert.equal(await handler({ method: "GET", headers: {} }, optionsResponse, new URL("http://localhost/api/project-copy/options")), true);
  assert.equal(JSON.parse(optionsResponse.body).destinationRoots[0], "/work");
});

test("project copy UI preflights before executing and presents exclusions", async () => {
  const requests = [];
  const alerts = [];
  const responses = [
    { status: "ok", destinationRoots: ["/Users/matrix/333.dev"] },
    { status: "ok", token: "a".repeat(64), fileCount: 71, bytes: 427722, conversationCount: 1, conversationBytes: 6000000, destinationDirectory: "/Users/matrix/333.dev/真仙幸存者", excluded: ["target"] },
    { status: "ok", verified: true, fileCount: 71, bytes: 427722, conversationCount: 1, destinationDirectory: "/Users/matrix/333.dev/真仙幸存者" }
  ];
  const control = createProjectCopyControl({
    fetchImpl: async (url, options = {}) => { requests.push([url, options]); return { ok: true, async json() { return responses.shift(); } }; },
    promptImpl: (_message, suggested) => suggested,
    confirmImpl: (message) => { assert.match(message, /target/); assert.match(message, /71 个项目文件/); assert.match(message, /1 个会话/); return true; },
    alertImpl: (message) => alerts.push(message)
  });
  const button = { disabled: false, textContent: "复制项目" };
  await control.copy({ id: "windows-pc" }, { project: "真仙幸存者", directory: "\\\\?\\D:\\333.开发\\真仙幸存者" }, button);
  assert.deepEqual(requests.map(([url]) => url), ["/api/project-copy/options", "/api/project-copy/preflight", "/api/project-copy/execute"]);
  assert.equal(JSON.parse(requests[2][1].body).preflightToken, "a".repeat(64));
  assert.match(alerts[0], /校验完成/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "复制项目");
});
