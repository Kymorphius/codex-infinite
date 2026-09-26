import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mirrorValidRouterCatalog, prepareWrapperCodexHome, withoutWrapperContextConfig } from "../src/wrapper-codex-home.mjs";

test("wrapper config keeps model defaults when source has no root context override", () => {
  const source = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n\n[features]\nfoo = true\n';
  const result = withoutWrapperContextConfig(source);
  assert.equal(result, source);
});

test("wrapper config removes inherited root context and compaction limits", () => {
  const result = withoutWrapperContextConfig('model_context_window = 272000\nmodel_auto_compact_token_limit = 240000\n\n[features]\nfoo = true\n');
  assert.doesNotMatch(result, /model_context_window/);
  assert.doesNotMatch(result, /model_auto_compact_token_limit/);
  assert.match(result, /\[features\]\nfoo = true/);
});

test("wrapper CODEX_HOME shares sessions and auth while owning its config", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-home-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(path.join(sourceHome, "sessions"), { recursive: true });
  await fs.writeFile(path.join(sourceHome, "auth.json"), "{}", { mode: 0o600 });
  await fs.writeFile(path.join(sourceHome, "config.toml"), 'model = "gpt-5.6-sol"\n');
  const result = await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000 });
  assert.equal((await fs.lstat(path.join(wrapperHome, "sessions"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(wrapperHome, "auth.json"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(wrapperHome, "config.toml"))).isSymbolicLink(), false);
  assert.doesNotMatch(await fs.readFile(result.configPath, "utf8"), /model_context_window/);
  assert.doesNotMatch(await fs.readFile(result.configPath, "utf8"), /model_auto_compact_token_limit/);
  assert.equal((await fs.readFile(path.join(sourceHome, "config.toml"), "utf8")).includes("model_context_window"), false);
  const metadata = JSON.parse(await fs.readFile(result.metadataPath, "utf8"));
  assert.equal(metadata.defaultContextMode, "model-default");
  assert.equal(metadata.perThreadContextWindow, 1_000_000);
});

test("Windows wrapper uses the same allowlist with a distinct configuration", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-win-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(path.join(sourceHome, "sessions"), { recursive: true });
  await fs.writeFile(path.join(sourceHome, "auth.json"), "{}");
  const result = await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000, platform: "win32" });
  assert.deepEqual(result.sharedEntries.sort(), ["auth.json", "sessions", "state_5.sqlite-shm", "state_5.sqlite-wal"]);
  assert.equal((await fs.lstat(path.join(wrapperHome, "sessions"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(wrapperHome, "state_5.sqlite-shm"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(wrapperHome, "state_5.sqlite-wal"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(wrapperHome, "config.toml"))).isSymbolicLink(), false);
});

test("repeated preparation preserves native MCP, marketplace and model settings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-persistence-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source"), wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(sourceHome);
  const sourcePath = path.join(sourceHome, "config.toml");
  await fs.writeFile(sourcePath, 'model = "initial"\n');
  const options = { sourceHome, wrapperHome, contextWindow: 1_000_000 };
  const result = await prepareWrapperCodexHome(options);
  const local = 'model = "native-choice"\n\n[mcp_servers.hermes_context]\ncommand = "local-python"\n\n[marketplaces.openai-bundled]\nsource = "own-marketplace"\n';
  await fs.writeFile(result.configPath, local);
  const updatedSource = 'model = "source-changed"\n';
  await fs.writeFile(sourcePath, updatedSource);
  await prepareWrapperCodexHome(options);
  await prepareWrapperCodexHome(options);
  assert.equal(await fs.readFile(result.configPath, "utf8"), local);
  assert.equal(await fs.readFile(sourcePath, "utf8"), updatedSource);
  await fs.writeFile(result.configPath, 'model_context_window = 99\n' + local);
  await prepareWrapperCodexHome(options);
  assert.equal(await fs.readFile(result.configPath, "utf8"), local);
});

test("wrapper SQLite sidecar links survive targets appearing after preparation", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-sidecars-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(sourceHome, { recursive: true });

  await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000, platform: "win32" });
  for (const name of ["state_5.sqlite-shm", "state_5.sqlite-wal"]) {
    assert.equal((await fs.lstat(path.join(wrapperHome, name))).isSymbolicLink(), true);
    await fs.writeFile(path.join(sourceHome, name), name);
  }

  await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000, platform: "win32" });
  assert.equal(await fs.readFile(path.join(wrapperHome, "state_5.sqlite-shm"), "utf8"), "state_5.sqlite-shm");
  assert.equal(await fs.readFile(path.join(wrapperHome, "state_5.sqlite-wal"), "utf8"), "state_5.sqlite-wal");
});

test("wrapper preparation accepts a model cache atomically replaced by the running app", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-model-cache-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(sourceHome, { recursive: true });
  await fs.mkdir(wrapperHome, { recursive: true });
  await fs.writeFile(path.join(sourceHome, "models_cache.json"), '{"source":true}');
  await fs.writeFile(path.join(wrapperHome, "models_cache.json"), '{"wrapper":true}');

  const result = await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000 });

  assert.equal((await fs.lstat(path.join(wrapperHome, "models_cache.json"))).isSymbolicLink(), false);
  assert.equal(await fs.readFile(path.join(wrapperHome, "models_cache.json"), "utf8"), '{"wrapper":true}');
  assert.equal(result.sharedEntries.includes("models_cache.json"), false);
});

test("wrapper preparation mirrors a non-empty router catalog into its isolated home", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-router-catalog-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  const catalogDirectory = path.join(sourceHome, "codex-router");
  await fs.mkdir(catalogDirectory, { recursive: true });
  const source = JSON.stringify({ models: [{ slug: "gpt-test" }] }, null, 2);
  await fs.writeFile(path.join(catalogDirectory, "merged-models.json"), source);

  const result = await prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000 });

  assert.equal(result.routerCatalogPath, path.join(wrapperHome, "codex-router", "merged-models.json"));
  assert.equal(await fs.readFile(result.routerCatalogPath, "utf8"), source);
  assert.equal(JSON.parse(await fs.readFile(result.metadataPath, "utf8")).routerCatalogMirrored, true);
});

test("invalid or empty router catalogs never replace a valid wrapper catalog", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-empty-router-catalog-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(path.join(sourceHome, "codex-router"), { recursive: true });
  await fs.mkdir(path.join(wrapperHome, "codex-router"), { recursive: true });
  const targetPath = path.join(wrapperHome, "codex-router", "merged-models.json");
  await fs.writeFile(targetPath, JSON.stringify({ models: [{ slug: "keep" }] }));
  await fs.writeFile(path.join(sourceHome, "codex-router", "merged-models.json"), '{"models":[]}');

  assert.equal(await mirrorValidRouterCatalog(sourceHome, wrapperHome), null);
  assert.deepEqual(JSON.parse(await fs.readFile(targetPath, "utf8")), { models: [{ slug: "keep" }] });
});

test("wrapper preparation refuses a regular SQLite sidecar without replacing it", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-sidecar-refusal-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(sourceHome, { recursive: true });
  await fs.mkdir(wrapperHome, { recursive: true });
  await fs.writeFile(path.join(wrapperHome, "state_5.sqlite-shm"), "preserve-me");

  await assert.rejects(
    prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow: 1_000_000, platform: "win32" }),
    /state_5\.sqlite-shm 已存在且不是符号链接/
  );
  assert.equal(await fs.readFile(path.join(wrapperHome, "state_5.sqlite-shm"), "utf8"), "preserve-me");
});

test("Windows wrapper accepts only known regular sidecars for a verified active runtime", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-active-sidecars-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, "source");
  const wrapperHome = path.join(directory, "wrapper");
  await fs.mkdir(sourceHome, { recursive: true });
  await fs.mkdir(wrapperHome, { recursive: true });
  await fs.writeFile(path.join(wrapperHome, "state_5.sqlite-shm"), "live-shm");
  await fs.writeFile(path.join(wrapperHome, "state_5.sqlite-wal"), "live-wal");

  const result = await prepareWrapperCodexHome({
    sourceHome,
    wrapperHome,
    contextWindow: 1_000_000,
    platform: "win32",
    allowActiveRuntimeSidecars: true
  });

  assert.equal(await fs.readFile(path.join(wrapperHome, "state_5.sqlite-shm"), "utf8"), "live-shm");
  assert.equal(await fs.readFile(path.join(wrapperHome, "state_5.sqlite-wal"), "utf8"), "live-wal");
  assert.equal(result.sharedEntries.includes("state_5.sqlite-shm"), true);
  const metadata = JSON.parse(await fs.readFile(result.metadataPath, "utf8"));
  assert.equal(metadata.attachedRuntimeSidecarsAllowed, true);
});
