import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillConfigStore, skillEnabledFromConfig, updateSkillConfig } from "../src/skill-config-store.mjs";

test("Skill config reads native entries and preserves unrelated TOML", () => {
  const skillPath = "/workspace/demo/SKILL.md";
  const source = 'model = "gpt-5.6-sol"\n\n[[skills.config]]\npath = "/workspace/demo/SKILL.md"\nenabled = false\n\n[mcp_servers.docs]\nurl = "https://example.test"\n';
  assert.equal(skillEnabledFromConfig(source, skillPath), false);
  const enabled = updateSkillConfig(source, skillPath, true);
  assert.match(enabled, /model = "gpt-5\.6-sol"/);
  assert.match(enabled, /\[mcp_servers\.docs\]/);
  assert.doesNotMatch(enabled, /\[\[skills\.config\]\]/);
  const disabled = updateSkillConfig(enabled, skillPath, false);
  assert.equal(skillEnabledFromConfig(disabled, skillPath), false);
  assert.equal((disabled.match(/\[\[skills\.config\]\]/g) || []).length, 1);
});

test("Skill config store updates configured Codex homes atomically", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skill-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, "native", "config.toml");
  const second = path.join(directory, "wrapper", "config.toml");
  await fs.mkdir(path.dirname(first), { recursive: true });
  await fs.writeFile(first, 'model = "gpt-5.6-sol"\n');
  const store = new SkillConfigStore({ filePaths: [first, second] });
  const skillPath = path.join(directory, "skills", "demo", "SKILL.md");
  assert.deepEqual(await store.setEnabled(skillPath, false), { enabled: false, restartRequired: true });
  assert.equal(await store.isEnabled(skillPath), false);
  assert.match(await fs.readFile(first, "utf8"), /model = "gpt-5\.6-sol"/);
  assert.match(await fs.readFile(second, "utf8"), /enabled = false/);
  await store.setEnabled(skillPath, true);
  assert.equal(await store.isEnabled(skillPath), true);
});
