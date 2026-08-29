import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareWrapperCodexHome, withWrapperContextConfig } from "../src/wrapper-codex-home.mjs";

test("wrapper config inserts a root context window without changing ordinary Codex config", () => {
  const source = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n\n[features]\nfoo = true\n';
  const result = withWrapperContextConfig(source, 1_000_000);
  assert.match(result, /model_context_window = 1000000\nmodel_auto_compact_token_limit = 1000000\n\n\[features\]/);
  assert.equal(source.includes("model_context_window"), false);
  assert.equal(source.includes("model_auto_compact_token_limit"), false);
});

test("wrapper config replaces existing root context and compaction limits", () => {
  const result = withWrapperContextConfig('model_context_window = 272000\nmodel_auto_compact_token_limit = 240000\n\n[features]\nfoo = true\n', 1_000_000);
  assert.equal((result.match(/model_context_window/g) || []).length, 1);
  assert.equal((result.match(/model_auto_compact_token_limit/g) || []).length, 1);
  assert.match(result, /model_context_window = 1000000/);
  assert.match(result, /model_auto_compact_token_limit = 1000000/);
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
  assert.match(await fs.readFile(result.configPath, "utf8"), /model_context_window = 1000000/);
  assert.match(await fs.readFile(result.configPath, "utf8"), /model_auto_compact_token_limit = 1000000/);
  assert.equal((await fs.readFile(path.join(sourceHome, "config.toml"), "utf8")).includes("model_context_window"), false);
});
